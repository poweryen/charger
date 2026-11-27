// Offline rendering checks. Requires Playwright and a local Chromium/Chrome binary.
// The production startup is replaced in memory; no Firebase SDK, login or live data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const playwrightPath = process.env.CHARGER_PLAYWRIGHT || 'playwright';
const { chromium } = require(playwrightPath);
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-artifacts', 'browser');
fs.mkdirSync(out, { recursive: true });
const originalHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(originalHtml.includes('// APP_STARTUP') && originalHtml.includes('// APP_MAIN_END'));
const html = originalHtml.replace(/\/\/ APP_STARTUP[\s\S]*?\/\/ APP_MAIN_END/, `
window.CHARGER_QA = {
  apply(data, demo = false, error = '') {
    isOwnerAuthenticated = !demo;
    updateModeUI();
    applyDashboardData(demo ? data : normalizeDashboardPayload(data), demo, error);
  },
  demo(index = 0) {
    const scenario = DEMO_SCENARIOS[index];
    this.apply({ ...scenario, power: scenario.basePower, current: scenario.baseCurrent }, true);
  },
  history() {
    allHistoryRecords = normalizeHistoryPayload(DEMO_HISTORY);
    historyState = { kind: 'ready', message: '' };
    populateMonthDropdown(); renderHistory();
  }
};
// APP_MAIN_END`);
const base = () => ({
  status: 'Charging', power: 3.446, current: 15.17,
  power_valid: true, current_valid: true, ocpp_connection: 'on',
  updated_at: new Date().toISOString(), vehicle: 'Foxtron Bria', rate: 4.93,
  schedule: '00:00 ~ 06:00、11:00 ~ 14:00', session_energy: 1.8902,
  session_cost: 9.3, month_energy: 578.6289, month_cost: 1727.8,
  session_time: '2026-11-27 09:37:06 ~ 充電中', session_duration: '計時中'
});
const variants = [
  { name: 'charging-bria', kind: 'live' },
  { name: 'charging-n7', kind: 'live', patch: { vehicle: 'Luxgen n7' } },
  { name: 'available-zero', kind: 'zero', patch: { status: 'Available', power: 0, current: 0 } },
  { name: 'ocpp-off', kind: 'hidden', patch: { ocpp_connection: 'off', session_energy: 0, month_energy: 0 } },
  { name: 'ocpp-unknown', kind: 'hidden', patch: { ocpp_connection: 'unknown' } },
  { name: 'ocpp-missing', kind: 'hidden', remove: ['ocpp_connection'] },
  { name: 'stale', kind: 'hidden', patch: () => ({ updated_at: new Date(Date.now() - 360001).toISOString() }) },
  { name: 'read-error', kind: 'hidden', error: '模擬雲端讀取失敗' },
  { name: 'power-invalid', kind: 'power-hidden', patch: { power_valid: false } },
  { name: 'current-invalid', kind: 'current-hidden', patch: { current_valid: false } },
  { name: 'recovery', kind: 'live', before: { ocpp_connection: 'off' } },
  { name: 'demo-n7', kind: 'demo', demo: 0 },
  { name: 'demo-bria', kind: 'demo', demo: 1 }
];
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHARGER_CHROME ? { executablePath: process.env.CHARGER_CHROME } : {}),
    headless: true,
    args: ['--disable-background-networking', '--no-first-run', '--disable-sync']
  });
  const result = { browser: await browser.version(), sourceSha256: crypto.createHash('sha256').update(originalHtml).digest('hex'), cases: [], externalAttempts: [], pageErrors: [] };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:43127') {
          result.externalAttempts.push(url.origin + url.pathname);
          return route.abort('blockedbyclient');
        }
        if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        if (['/n7.PNG', '/bria.PNG'].includes(url.pathname)) {
          const filename = url.pathname.slice(1);
          const repositoryImage = path.join(root, filename);
          const imagePath = fs.existsSync(repositoryImage) ? repositoryImage : path.join(__dirname, 'fixtures', filename);
          return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(imagePath) });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      const page = await context.newPage();
      page.on('pageerror', error => result.pageErrors.push(error.message));
      await page.goto('http://127.0.0.1:43127/', { waitUntil: 'load' });
      await page.evaluate(() => window.CHARGER_QA.history());
      for (const variant of variants) {
        const data = { ...base(), ...(typeof variant.patch === 'function' ? variant.patch() : variant.patch || {}) };
        for (const key of variant.remove || []) delete data[key];
        await page.evaluate(({ healthy, before, data, demo, error }) => {
          window.CHARGER_QA.apply(healthy);
          if (before) window.CHARGER_QA.apply({ ...healthy, ...before });
          if (demo !== undefined) window.CHARGER_QA.demo(demo);
          else window.CHARGER_QA.apply(data, false, error || '');
        }, { healthy: base(), before: variant.before, data, demo: variant.demo, error: variant.error });
        if (['live', 'demo'].includes(variant.kind)) {
          await page.waitForFunction(() => { const img = document.getElementById('teslaCarMain'); return img && img.complete && img.naturalWidth > 0; });
        }
        const details = await page.evaluate(() => {
          const byId = id => document.getElementById(id);
          const rect = id => { const r = byId(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          return {
            status: byId('statusBadge').textContent, power: byId('powerVal').textContent,
            current: byId('currentVal').textContent, voltage: byId('voltageSub').textContent,
            load: byId('loadSub').textContent, cloud: byId('syncStatusText').textContent,
            ocpp: byId('ocppStatusText')?.textContent || '',
            sessionTime: byId('sessionTime').textContent, sessionDuration: byId('sessionDuration').textContent,
            stageActive: byId('teslaChargingStage').classList.contains('active'),
            flow1: byId('flowLine1').className, flow2: byId('flowLine2').className,
            monthEnergy: byId('monthEnergy').textContent,
            viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
            footer: rect('footerBar'), imageLoaded: byId('teslaCarMain').naturalWidth > 0
          };
        });
        assert(details.pageWidth <= viewport.width + 1, `${variant.name}: horizontal overflow at ${viewport.width}`);
        if (variant.kind === 'hidden') {
          assert(details.power.includes('--') && details.current.includes('--'), variant.name + ': gauges not hidden');
          assert(!details.stageActive && !details.flow1.includes('charging') && !details.flow2.includes('charging'), variant.name + ': animation active');
        } else if (variant.kind === 'power-hidden') {
          assert(details.power.includes('--') && !details.current.includes('--'));
          assert(!details.stageActive && !details.flow1.includes('charging'));
        } else if (variant.kind === 'current-hidden') {
          assert(details.current.includes('--') && !details.power.includes('--'));
          assert(details.voltage.includes('--') && details.load.includes('--'));
          assert(!details.stageActive && !details.flow1.includes('charging'));
        } else if (variant.kind === 'zero') {
          assert(details.power.includes('0.00') && details.current.includes('0.00'));
          assert(!details.stageActive);
        } else {
          assert(!details.power.includes('--') && !details.current.includes('--'));
          assert(details.stageActive && details.flow1.includes('charging'));
        }
        const screenshot = `${viewport.width}-${variant.name}.png`;
        await page.screenshot({ path: path.join(out, screenshot), fullPage: true, animations: 'disabled' });
        result.cases.push({ viewport, scenario: variant.name, ...details, screenshot });
      }
      await context.close();
    }
    assert.equal(result.externalAttempts.length, 0, 'Unexpected external requests attempted');
    assert.equal(result.pageErrors.length, 0, 'Unexpected page errors');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
    console.log(`PASS ${result.cases.length} desktop/mobile rendering scenarios; 0 external requests; 0 page errors`);
    console.log(path.join(out, 'results.json'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
