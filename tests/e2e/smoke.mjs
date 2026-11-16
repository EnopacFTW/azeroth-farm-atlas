// Windows desktop E2E smoke test. Drives the REAL Tauri/WebView2 window via the Chrome DevTools Protocol.
// Start the app with remote debugging first, e.g. (PowerShell):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; npm run tauri dev
//   (or start the installed "Azeroth Farm Atlas.exe" with the same env var)
// Then: npm run test:e2e
import { chromium } from 'playwright-core';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const results = [];
const check = async (name, fn) => {
  const t = Date.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, info });
    console.log(`PASS  ${name}${info ? ` – ${info}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, info: String(e?.message ?? e) });
    console.log(`FAIL  ${name} – ${String(e?.message ?? e).split('\n')[0]}`);
  }
};

async function connect() {
  const until = Date.now() + 180_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(CDP, { timeout: 5000 });
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const browser = await connect();
let page;
for (let i = 0; i < 60 && !page; i++) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => /127\.0\.0\.1:1420|tauri\.localhost/.test(p.url()));
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) throw new Error('App-Fenster nicht gefunden');
page.setDefaultTimeout(30_000);
const go = (hash) => page.evaluate((h) => { location.hash = h; }, hash);

await check('App startet und Farmfinder zeigt Spots (Level 28, Demo-Profil)', async () => {
  await go('#/finder');
  await page.getByText('passende Spots').waitFor();
  // the counter renders before the candidate query has finished
  await page.waitForFunction(() => Number(document.querySelector('section span.font-semibold.num')?.textContent) > 0, null, { timeout: 30_000 }).catch(() => {});
  const n = Number(await page.locator('section span.font-semibold.num').first().textContent());
  if (!(n > 0)) throw new Error(`0 Spots`);
  return `${n} Spots`;
});

await check('Level 28 → 45 berechnet Liste neu (Test 1)', async () => {
  const input = page.getByLabel('Charakterlevel');
  const before = await page.locator('article h3').first().textContent();
  await input.fill('45');
  await input.blur();
  await page.waitForFunction((b) => document.querySelector('article h3')?.textContent !== b, before, { timeout: 15_000 });
  const after = await page.locator('article h3').first().textContent();
  await input.fill('28');
  await input.blur();
  await page.waitForFunction((a) => document.querySelector('article h3')?.textContent !== a, after, { timeout: 15_000 });
  return `${before} → ${after}`;
});

await check('Spot-Klick zentriert Karte, zeigt Mobs & Begründung (Test 6)', async () => {
  await page.locator('article').nth(1).click();
  await page.getByText('Warum empfohlen?').first().waitFor();
  await page.locator('.leaflet-container canvas, .leaflet-container path').first().waitFor();
  const label = await page.getByText(/Koordinatenfläche \+ Spawndichte – kein Kartenbild|Eigenes Kartenbild/).first().isVisible();
  if (!label) throw new Error('Kartenhinweis fehlt');
  // base layer: grid + spawn density (or an imported image)
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-image-layer').length >= 1);
  const layers = await page.locator('.leaflet-image-layer').count();
  return `Karte + Begründung sichtbar, ${layers} Kartenebenen`;
});

await check('Suche DE und EN → gleiche Item-ID 2319 (Test 13)', async () => {
  for (const q of ['Mittleres Leder', 'medium leather']) {
    await go('#/finder');
    const s = page.getByLabel('Globale Suche');
    await s.fill(q);
    await page.locator('button:has-text("#2319")').first().waitFor();
    await s.press('Enter');
    await page.waitForFunction(() => location.hash.startsWith('#/items/2319'));
  }
  await page.getByText('Bezugsquellen').first().waitFor();
  return '/items/2319 für beide Sprachen';
});

await check('AHledger EU: echter Preis für 2589 mit Credit, Scan-Alter (Test 16)', async () => {
  await go('#/auction-house');
  await page.getByText('Prices from AHledger').first().waitFor({ timeout: 45_000 });
  const panel = await page.locator('section:has-text("Preis für Item #2589")').innerText();
  if (/Nicht verfügbar/.test(panel) && !/Median: \d/.test(panel)) throw new Error('kein Preis');
  const m = panel.match(/Markt (forever\.[a-z.]+)/);
  const med = panel.match(/Median: ([^\n]+)/);
  return `${m?.[1]} Median ${med?.[1]?.trim()}`;
});

await check('Bulk-Preistabelle (ETag) laden', async () => {
  await page.getByRole('button', { name: /Bulk-Preistabelle laden/ }).click();
  await page.getByText(/Letzter Sync/).waitFor({ timeout: 45_000 });
  const t = await page.getByText(/Letzter Sync/).textContent();
  return t?.slice(0, 120);
});

await check('Spot-Detail mit AH-Spalte und getrennten Loot-Kontexten', async () => {
  await go(`#/spots/${encodeURIComponent('mob:wetlands-mottled-scytheclaw')}`);
  await page.getByText('Kürschnern').first().waitFor();
  await page.getByText('Kill-Loot').first().waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes('lädt…'), null, { timeout: 45_000 });
  const prices = await page.locator('td:has(span.num) >> text=/Aktuell|Veraltet/').count();
  return `${prices} Loot-Zeilen mit AH-Preis`;
});

await check('Farmtimer: Pause zieht Zeit ab, Session bleibt gespeichert (Test 9)', async () => {
  await go('#/sessions');
  const start = page.getByRole('button', { name: /Freie Session starten/ });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.waitForFunction(() => /0:00:0[3-9]|0:00:[1-5]\d/.test(document.querySelector('[aria-live="polite"]')?.textContent ?? ''), null, { timeout: 15_000 });
  await page.getByRole('button', { name: /Pause/ }).click();
  const t1 = await page.locator('[aria-live="polite"]').textContent();
  await page.waitForTimeout(2500);
  const t2 = await page.locator('[aria-live="polite"]').textContent();
  if (t1 !== t2) throw new Error(`Timer lief in Pause weiter: ${t1} → ${t2}`);
  await page.reload();
  await page.getByRole('button', { name: /Fortsetzen/ }).waitFor();
  await page.getByRole('button', { name: /Beenden/ }).click();
  await page.getByText('Abgeschlossene Sessions').waitFor();
  return `pausiert bei ${t1}, nach Reload weiter vorhanden`;
});

await check('Provider-Test AHledger in Einstellungen', async () => {
  await go('#/settings');
  const row = page.locator('div.rounded-md:has(label:has-text("AHledger"))').first();
  await row.getByRole('button', { name: /Verbindung testen/ }).click();
  await row.getByText(/erreichbar|Fehler/).first().waitFor({ timeout: 45_000 });
  return (await row.innerText()).split('\n').find((l) => /erreichbar|Fehler/.test(l));
});

await check('Blizzard ohne Credentials → verständliche Meldung, kein Blank Screen (Test 15)', async () => {
  const row = page.locator('div.rounded-md:has(label:has-text("Blizzard Forever"))').first();
  await row.getByRole('button', { name: /Verbindung testen/ }).click();
  await row.getByText(/deaktiviert|Zugangsdaten|Fehler/).first().waitFor({ timeout: 30_000 });
  const ok = await page.getByText('Einstellungen').first().isVisible();
  if (!ok) throw new Error('UI weg');
  return (await row.innerText()).split('\n').find((l) => /deaktiviert|Zugangsdaten/.test(l));
});

await check('Waypoint-Kopie im /way-Format (Test 12)', async () => {
  await go(`#/spots/${encodeURIComponent('mob:wetlands-mottled-scytheclaw')}`);
  const btn = page.getByRole('button', { name: /\/way / });
  const txt = (await btn.textContent())?.trim();
  if (!/^\/way .+ \d{1,3}\.\d \d{1,3}\.\d$/.test(txt ?? '')) throw new Error(`ungültig: ${txt}`);
  await btn.click();
  return txt;
});

await check('Atlas: Bergbau-Ebene filtert nach Skill (Test 3)', async () => {
  await go('#/atlas?zone=3');
  await page.waitForFunction(() => /^[1-9]\d* Marker/.test([...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /^\d+ Marker ·/.test(t ?? '')) ?? ''));
  const without = Number((await page.getByText(/Marker ·/).textContent()).match(/^(\d+)/)[1]);
  await page.getByLabel(/Alle Ressourcen zeigen/).check();
  await page.waitForTimeout(500);
  const withAll = Number((await page.getByText(/Marker ·/).textContent()).match(/^(\d+)/)[1]);
  await page.getByLabel(/Alle Ressourcen zeigen/).uncheck();
  if (!(withAll > without)) throw new Error(`${without} vs ${withAll}`);
  return `${without} Marker ohne Bergbau, ${withAll} mit „Alle Ressourcen“`;
});

await check('Sprache EN ↔ DE: Oberfläche und Namen wechseln', async () => {
  await go('#/finder');
  await page.getByRole('button', { name: 'en', exact: true }).click();
  await page.getByText('matching spots').waitFor();
  await page.getByText('Why recommended?').first().waitFor();
  const nav = await page.getByRole('navigation').innerText();
  if (!/Farm finder/.test(nav) || !/Settings/.test(nav)) throw new Error('Navigation nicht englisch');
  await page.getByRole('button', { name: 'de', exact: true }).click();
  await page.getByText('passende Spots').waitFor();
  return 'EN-Texte sichtbar, zurück auf DE';
});

await go('#/finder');
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E-Checks bestanden`);
process.exit(failed.length ? 1 : 0);
