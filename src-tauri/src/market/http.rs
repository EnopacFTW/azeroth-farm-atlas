//! Shared HTTP client: allowlist, timeouts, size limits, retries with jitter, Retry-After, ETag, Cache-Control.

use crate::error::AppError;
use crate::security::network_policy::NetworkPolicy;
use rand::Rng;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub etag: Option<String>,
    pub max_age_secs: Option<u64>,
    pub elapsed_ms: u64,
    pub last_modified: Option<String>,
}

impl HttpResponse {
    pub fn for_tests(body: &str, max_age_secs: Option<u64>) -> Self {
        Self { status: 200, body: body.as_bytes().to_vec(), etag: None, max_age_secs, elapsed_ms: 1, last_modified: None }
    }
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, AppError> {
        serde_json::from_slice(&self.body).map_err(|e| AppError::new("schema", crate::i18n::tr(format!("Antwort hat ein unerwartetes Format: {e}"), format!("Response has an unexpected format: {e}"))))
    }
    pub fn text(&self) -> Result<String, AppError> {
        String::from_utf8(self.body.clone()).map_err(|_| AppError::new("schema", crate::i18n::tr("Antwort ist kein UTF-8-Text", "Response is not UTF-8 text")))
    }
}

#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    pub bearer: Option<String>,
    pub basic_auth: Option<(String, String)>,
    pub form: Option<Vec<(String, String)>>,
    pub if_none_match: Option<String>,
    pub max_bytes: Option<usize>,
    pub timeout: Option<Duration>,
    pub max_retries: Option<u32>,
}

#[derive(Clone)]
pub struct HttpClient {
    client: reqwest::Client,
    policy: NetworkPolicy,
    /// Base delay for retries; small in tests.
    pub retry_base: Duration,
}

pub const USER_AGENT: &str = concat!("FarmForever/", env!("CARGO_PKG_VERSION"), " (Windows desktop; read-only)");

impl HttpClient {
    pub fn new(policy: NetworkPolicy) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .gzip(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http client");
        Self { client, policy, retry_base: Duration::from_millis(600) }
    }

    pub async fn get(&self, url: &str, opts: RequestOptions) -> Result<HttpResponse, AppError> {
        self.send(reqwest::Method::GET, url, opts).await
    }

    pub async fn post_form(&self, url: &str, opts: RequestOptions) -> Result<HttpResponse, AppError> {
        self.send(reqwest::Method::POST, url, opts).await
    }

    async fn send(&self, method: reqwest::Method, url: &str, opts: RequestOptions) -> Result<HttpResponse, AppError> {
        let checked = self.policy.check(url)?;
        let max_retries = opts.max_retries.unwrap_or(2);
        let max_bytes = opts.max_bytes.unwrap_or(8 * 1024 * 1024);
        let mut attempt = 0u32;
        loop {
            let started = std::time::Instant::now();
            let mut req = self.client.request(method.clone(), checked.clone()).header("Accept", "application/json, text/plain");
            if let Some(t) = opts.timeout {
                req = req.timeout(t);
            }
            if let Some(b) = &opts.bearer {
                req = req.bearer_auth(b);
            }
            if let Some((u, p)) = &opts.basic_auth {
                req = req.basic_auth(u, Some(p));
            }
            if let Some(f) = &opts.form {
                req = req.form(f);
            }
            if let Some(e) = &opts.if_none_match {
                req = req.header("If-None-Match", e);
            }
            let result = req.send().await;
            let retryable_err = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = resp.headers().clone();
                    let retry_after = headers
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.trim().parse::<u64>().ok());
                    if (status == 429 || status >= 500) && attempt < max_retries {
                        let wait = retry_after.map(Duration::from_secs).unwrap_or_else(|| self.backoff(attempt));
                        if wait <= Duration::from_secs(30) {
                            attempt += 1;
                            tokio::time::sleep(wait).await;
                            continue;
                        }
                    }
                    if status == 429 {
                        let mut e = AppError::new("rate_limited", crate::i18n::tr("Anbieter-Ratelimit erreicht (429). Bitte später erneut versuchen.", "Provider rate limit reached (429). Please try again later.")).with_status(429);
                        e.retry_after_secs = retry_after;
                        return Err(e);
                    }
                    if let Some(len) = resp.content_length() {
                        if len as usize > max_bytes {
                            return Err(AppError::new("too_large", crate::i18n::tr(format!("Antwort zu groß ({len} Bytes, Grenze {max_bytes})"), format!("Response too large ({len} bytes, limit {max_bytes})"))));
                        }
                    }
                    let etag = headers.get("etag").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
                    let max_age_secs = headers.get("cache-control").and_then(|v| v.to_str().ok()).and_then(parse_max_age);
                    let last_modified = headers
                        .get("last-modified")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| chrono::DateTime::parse_from_rfc2822(v).ok())
                        .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
                    let body = read_limited(resp, max_bytes).await?;
                    let out = HttpResponse { status, body, etag, max_age_secs, elapsed_ms: started.elapsed().as_millis() as u64, last_modified };
                    return classify(out);
                }
                Err(e) => e,
            };
            let timeout = retryable_err.is_timeout();
            if attempt < max_retries && (timeout || retryable_err.is_connect() || retryable_err.is_request()) {
                attempt += 1;
                tokio::time::sleep(self.backoff(attempt)).await;
                continue;
            }
            return Err(if timeout {
                AppError::new("timeout", crate::i18n::tr("Zeitüberschreitung beim Anbieter", "Provider timed out"))
            } else if retryable_err.is_connect() {
                AppError::new("offline", crate::i18n::tr("Keine Verbindung zum Anbieter (offline?)", "No connection to the provider (offline?)"))
            } else {
                AppError::new("network", crate::i18n::tr(format!("Netzwerkfehler: {}", redact(&retryable_err.to_string())), format!("Network error: {}", redact(&retryable_err.to_string()))))
            });
        }
    }

    fn backoff(&self, attempt: u32) -> Duration {
        let base = self.retry_base.as_millis() as u64 * 2u64.pow(attempt.min(5));
        let jitter = rand::rng().random_range(0..=base / 2 + 1);
        Duration::from_millis(base + jitter)
    }
}

async fn read_limited(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, AppError> {
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| AppError::new("network", crate::i18n::tr(format!("Abbruch beim Lesen: {}", redact(&e.to_string())), format!("Aborted while reading: {}", redact(&e.to_string())))))? {
        if buf.len() + chunk.len() > max {
            return Err(AppError::new("too_large", crate::i18n::tr(format!("Antwort überschreitet {max} Bytes"), format!("Response exceeds {max} bytes"))));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

fn classify(r: HttpResponse) -> Result<HttpResponse, AppError> {
    match r.status {
        200..=299 | 304 => Ok(r),
        401 => Err(AppError::new("unauthorized", crate::i18n::tr("Anmeldung abgelehnt (401) – Zugangsdaten prüfen.", "Sign-in rejected (401) – check credentials.")).with_status(401)),
        403 => Err(AppError::new("forbidden", crate::i18n::tr("Zugriff verweigert (403) – Berechtigung/Feature/Namespace fehlt.", "Access denied (403) – permission/feature/namespace missing.")).with_status(403)),
        404 => Err(AppError::new("not_found", crate::i18n::tr("Nicht gefunden (404).", "Not found (404).")).with_status(404)),
        s if s >= 500 => Err(AppError::new("provider_down", crate::i18n::tr(format!("Anbieterfehler ({s})."), format!("Provider error ({s})."))).with_status(s)),
        400 => Err(AppError::new("bad_request", crate::i18n::tr(format!("Anfrage abgelehnt (400){}", body_hint(&r.body)), format!("Request rejected (400){}", body_hint(&r.body)))).with_status(400)),
        s => Err(AppError::new("http", crate::i18n::tr(format!("Unerwarteter HTTP-Status {s}."), format!("Unexpected HTTP status {s}."))).with_status(s)),
    }
}

/// Short, safe hint from a JSON error body such as `{"error":"bad_market"}`.
fn body_hint(body: &[u8]) -> String {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| format!(": {}", s.chars().take(60).collect::<String>())))
        .unwrap_or_default()
}

pub fn parse_max_age(v: &str) -> Option<u64> {
    v.split(',').map(|p| p.trim()).find_map(|p| p.strip_prefix("max-age=").and_then(|n| n.parse().ok()))
}

/// Never let tokens or secrets leak into error strings.
pub fn redact(s: &str) -> String {
    let mut out = s.to_string();
    for key in ["access_token=", "client_secret=", "token="] {
        if let Some(i) = out.find(key) {
            let end = out[i..].find(['&', ' ', ')']).map(|e| i + e).unwrap_or(out.len());
            out.replace_range(i + key.len()..end, "***");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_age_parsing() {
        assert_eq!(parse_max_age("public, max-age=60, s-maxage=300"), Some(60));
        assert_eq!(parse_max_age("no-store"), None);
    }

    #[test]
    fn redacts_tokens() {
        let r = redact("error at https://x/?namespace=a&access_token=abc123&x=1");
        assert!(!r.contains("abc123"));
    }

    fn client() -> HttpClient {
        let mut c = HttpClient::new(NetworkPolicy::loopback_for_tests());
        c.retry_base = Duration::from_millis(5);
        c
    }

    #[tokio::test]
    async fn status_mapping() {
        let mut server = mockito::Server::new_async().await;
        for (code, expect) in [(401, "unauthorized"), (403, "forbidden"), (404, "not_found")] {
            let path = format!("/s{code}");
            let _m = server.mock("GET", path.as_str()).with_status(code).create_async().await;
            let err = client().get(&format!("{}{}", server.url(), path), RequestOptions::default()).await.unwrap_err();
            assert_eq!(err.code, expect);
        }
    }

    #[tokio::test]
    async fn retries_5xx_then_fails() {
        let mut server = mockito::Server::new_async().await;
        let m = server.mock("GET", "/boom").with_status(503).expect(3).create_async().await;
        let err = client().get(&format!("{}/boom", server.url()), RequestOptions::default()).await.unwrap_err();
        assert_eq!(err.code, "provider_down");
        m.assert_async().await;
    }

    #[tokio::test]
    async fn rate_limit_with_long_retry_after_is_not_waited() {
        let mut server = mockito::Server::new_async().await;
        let _m = server.mock("GET", "/rl").with_status(429).with_header("retry-after", "120").create_async().await;
        let err = client().get(&format!("{}/rl", server.url()), RequestOptions::default()).await.unwrap_err();
        assert_eq!(err.code, "rate_limited");
        assert_eq!(err.retry_after_secs, Some(120));
    }

    #[tokio::test]
    async fn etag_304_passes_through() {
        let mut server = mockito::Server::new_async().await;
        let _m = server.mock("GET", "/t").match_header("if-none-match", "\"abc\"").with_status(304).create_async().await;
        let r = client()
            .get(&format!("{}/t", server.url()), RequestOptions { if_none_match: Some("\"abc\"".into()), ..Default::default() })
            .await
            .unwrap();
        assert_eq!(r.status, 304);
    }

    #[tokio::test]
    async fn size_limit_enforced() {
        let mut server = mockito::Server::new_async().await;
        let _m = server.mock("GET", "/big").with_body(vec![b'x'; 2048]).create_async().await;
        let err = client()
            .get(&format!("{}/big", server.url()), RequestOptions { max_bytes: Some(1024), ..Default::default() })
            .await
            .unwrap_err();
        assert_eq!(err.code, "too_large");
    }

    #[tokio::test]
    async fn timeout_is_reported() {
        // Unroutable TEST-NET address with tiny timeout -> timeout or offline, never a fake success.
        let c = client();
        let err = c
            .get("http://127.0.0.1:9/never", RequestOptions { timeout: Some(Duration::from_millis(50)), max_retries: Some(0), ..Default::default() })
            .await
            .unwrap_err();
        assert!(["timeout", "offline", "network"].contains(&err.code.as_str()), "got {}", err.code);
    }
}
