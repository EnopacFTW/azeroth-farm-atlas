//! Domain allowlist (SSRF protection). The frontend can never make Rust fetch an arbitrary URL:
//! providers build URLs from fixed bases and every request is checked here.

use crate::error::AppError;
use url::Url;

pub const PRODUCTION_HOSTS: &[&str] = &[
    "api.ahledger.com",
    "auctionhouse.fyi",
    "oauth.battle.net",
    "eu.api.blizzard.com",
    "us.api.blizzard.com",
    "kr.api.blizzard.com",
    "tw.api.blizzard.com",
];

#[derive(Clone, Debug)]
pub struct NetworkPolicy {
    hosts: Vec<String>,
    allow_http_loopback: bool,
}

impl NetworkPolicy {
    pub fn production() -> Self {
        Self { hosts: PRODUCTION_HOSTS.iter().map(|s| s.to_string()).collect(), allow_http_loopback: false }
    }

    /// Only for tests against a local mock server.
    #[cfg(test)]
    pub fn loopback_for_tests() -> Self {
        Self { hosts: vec!["127.0.0.1".into()], allow_http_loopback: true }
    }

    pub fn check(&self, raw: &str) -> Result<Url, AppError> {
        let url = Url::parse(raw).map_err(|_| AppError::new("blocked_url", "Ungültige URL"))?;
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let scheme_ok = url.scheme() == "https" || (self.allow_http_loopback && url.scheme() == "http" && host == "127.0.0.1");
        if !scheme_ok || !self.hosts.iter().any(|h| h == &host) {
            return Err(AppError::new("blocked_host", format!("Host nicht freigegeben: {host}")));
        }
        if url.username() != "" || url.password().is_some() {
            return Err(AppError::new("blocked_url", "URL mit Zugangsdaten abgelehnt"));
        }
        Ok(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_known_hosts_only() {
        let p = NetworkPolicy::production();
        assert!(p.check("https://api.ahledger.com/v1/markets").is_ok());
        assert!(p.check("https://eu.api.blizzard.com/data/wow/ruleset/index").is_ok());
        assert!(p.check("http://api.ahledger.com/v1/markets").is_err(), "plain http must be rejected");
        assert!(p.check("https://evil.example.com/").is_err());
        assert!(p.check("https://api.ahledger.com.evil.com/").is_err());
        assert!(p.check("https://user:pw@api.ahledger.com/").is_err());
        assert!(p.check("file:///C:/Windows/win.ini").is_err());
    }
}
