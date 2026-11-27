'use strict';

// Exercise the actual inline app without loading Firebase or contacting a charger.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const htmlPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/<script id="app-main">([\s\S]*?)<\/script>/);
assert.ok(match, 'app-main script must exist');
const source = match[1].split('// APP_STARTUP')[0];
const NOW = Date.parse('2026-11-27T02:10:00Z');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.value = '';
    this._text = '';
    this.classList = {
      add: (...names) => this._classes(names, []),
      remove: (...names) => this._classes([], names),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const yes = force === undefined ? !this.classList.contains(name) : force;
        this._classes(yes ? [name] : [], yes ? [] : [name]);
        return yes;
      }
    };
  }
  _classes(add, remove) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    remove.forEach(name => names.delete(name));
    add.forEach(name => names.add(name));
    this.className = [...names].join(' ');
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return { width: 450, height: 240, left: 0, top: 0 }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  focus() {}
  click() {}
  remove() {}
}

function app() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  for (const id of html.matchAll(/\bid="([^"]+)"/g)) get(id[1]);
  const timers = [];
  let networkCalls = 0;
  class Clock extends Date { static now() { return NOW; } }
  class NoNetworkImage extends Element { constructor() { super('img'); } }
  const context = vm.createContext({
    Date: Clock, URL, URLSearchParams, AbortController, DOMException, Blob,
    console, Math, Image: NoNetworkImage,
    document: {
      title: 'dashboard test', getElementById: get,
      createElement: tag => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
      createTextNode: text => ({ textContent: String(text) }),
      querySelectorAll: () => [], body: new Element('body')
    },
    window: { location: { href: 'https://example.invalid/' }, history: {}, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => { networkCalls += 1; throw new Error('Network is disabled in tests'); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, alert() {}
  });
  new vm.Script(source, { filename: 'app-main.js' }).runInContext(context);
  const run = code => vm.runInContext(code, context);
  // Keep real rendering and state handling; disable only image loading effects.
  run('startLoadingGitHubCarImage = function () {};');
  return {
    get, run, context, timers,
    networkCalls: () => networkCalls,
    call(name, ...args) {
      context.__args = args;
      return run(`${name}(...__args)`);
    }
  };
}

function data(overrides = {}) {
  return {
    status: 'Charging', vehicle: 'Foxtron Bria', ocpp_connection: 'on',
    power_valid: true, current_valid: true, power: 3.446, current: 15.17,
    updated_at: '2026-11-27 10:09:35', rate: 4.93,
    schedule: '00:00 ~ 06:00、11:00 ~ 14:00',
    session_time: '2026-11-27 09:37:06 ~ 充電中', session_duration: '計時中',
    session_energy: 1.8902, session_cost: 9.3, month_energy: 578.6289, month_cost: 1727.8,
    ...overrides
  };
}

const summaryIds = ['sessionEnergy', 'sessionCost', 'monthEnergy', 'monthCost', 'vehicleName'];
const summary = a => summaryIds.map(id => a.get(id).textContent);
function assertPaused(a) {
  assert.equal(a.get('teslaChargingStage').classList.contains('active'), false);
  assert.equal(a.get('statusBadge').classList.contains('charging'), false);
  for (const id of ['flowLine1', 'flowLine2']) {
    assert.equal(a.get(id).classList.contains('charging'), false, `${id} must stop flowing`);
  }
}
function assertHidden(a) {
  assert.match(a.get('powerVal').textContent, /^--/);
  assert.match(a.get('currentVal').textContent, /^--/);
  assert.match(a.get('voltageSub').textContent, /--/);
  assert.match(a.get('loadSub').textContent, /--/);
  assertPaused(a);
}

test('actual script parses without startup or network', () => {
  const a = app();
  assert.equal(a.networkCalls(), 0);
  assert.equal(a.run('CONFIG.staleAfterMs'), 360000);
});

test('fresh Charging and Available preserve finite measurements, including zero', () => {
  const a = app();
  const live = a.call('getDashboardHealth', data());
  assert.equal(live.canUseRealtime, true);
  assert.equal(live.power, 3.446);
  assert.equal(live.current, 15.17);
  assert.equal(live.animate, true);
  a.call('applyDashboardData', data());
  assert.match(a.get('powerVal').textContent, /^3\.45/);
  assert.match(a.get('currentVal').textContent, /^15\.17/);
  assert.match(a.get('voltageSub').textContent, /227\.2/);
  assert.equal(a.get('teslaChargingStage').classList.contains('active'), true);
  a.call('applyDashboardData', data({ status: 'Available', power: 0, current: 0 }));
  assert.match(a.get('powerVal').textContent, /^0\.00/);
  assert.match(a.get('currentVal').textContent, /^0\.00/);
  assert.match(a.get('loadSub').textContent, /0%/);
  assertPaused(a);
  assert.match(a.get('statusBadge').textContent, /待命/);
});

test('off, unknown, absent and malformed OCPP never reuse instant values', () => {
  for (const connection of ['off', 'unknown', undefined, null, true, false, 1, 'unavailable']) {
    const a = app();
    a.call('applyDashboardData', data());
    const before = summary(a);
    const next = data({ ocpp_connection: connection, power: 8, current: 32, voltage: 230,
      session_energy: 0, session_cost: 0, month_energy: 0, month_cost: 0, vehicle: 'Unknown' });
    const health = a.call('getDashboardHealth', next);
    assert.equal(health.canUseRealtime, false, `untrusted OCPP value: ${String(connection)}`);
    assert.equal(health.animate, false);
    a.call('applyDashboardData', next);
    assertHidden(a);
    assert.deepEqual(summary(a), before);
    assert.match(a.get('sessionTime').textContent + a.get('sessionDuration').textContent, /非即時|上次|最後|暫停確認/);
    assert.doesNotMatch(a.get('statusBadge').textContent, /待命|充電結束|已停止/);
  }
});

test('Available with a connection/cloud failure does not claim standby in the energy flow', () => {
  for (const [overrides, error] of [
    [{ ocpp_connection: 'off' }, ''],
    [{ ocpp_connection: 'unknown' }, ''],
    [{ updated_at: NOW - 360000 }, ''],
    [{}, '模擬雲端讀取失敗']
  ]) {
    const a = app();
    a.call('applyDashboardData', data({ status: 'Available', power: 0, current: 0 }));
    a.call('applyDashboardData', data({ status: 'Available', power: 0, current: 0, ...overrides }), false, error);
    assertHidden(a);
    assert.doesNotMatch(a.get('flowEvseSub').textContent, /待命|未充電|充電結束|已停止/);
    assert.match(a.get('flowEvseSub').textContent, /失聯|未知|逾時|讀取錯誤/);
  }
});

test('6 minute boundary and missing/invalid/future HA timestamps are untrusted', () => {
  const a = app();
  assert.equal(a.call('getDashboardHealth', data({ updated_at: NOW - 359999 })).canUseRealtime, true);
  for (const timestamp of [NOW - 360000, NOW - 360001, undefined, null, '', 'invalid', '2026-02-30 12:00:00', NOW + 300001]) {
    a.call('applyDashboardData', data());
    const before = summary(a);
    const next = data({ updated_at: timestamp, session_energy: 0, month_energy: 0 });
    assert.equal(a.call('getDashboardHealth', next).canUseRealtime, false, `timestamp: ${String(timestamp)}`);
    a.call('applyDashboardData', next);
    assertHidden(a);
    assert.deepEqual(summary(a), before);
  }
});

test('strict validity flags hide only their measurement and dependent values', () => {
  for (const flag of [false, undefined, null, 'false', 'true', 0, 1]) {
    for (const field of ['power_valid', 'current_valid']) {
      const a = app();
      const next = data({ [field]: flag });
      let normalized;
      try { normalized = a.call('normalizeDashboardPayload', next); }
      catch {
        assert.notEqual(typeof flag, 'boolean', 'real boolean false must be accepted');
        continue;
      }
      a.call('applyDashboardData', normalized);
      assert.match(a.get(field === 'power_valid' ? 'powerVal' : 'currentVal').textContent, /^--/);
      assert.doesNotMatch(a.get(field === 'power_valid' ? 'currentVal' : 'powerVal').textContent, /^--/);
      assert.match(a.get('voltageSub').textContent, /--/);
      if (field === 'current_valid') assert.match(a.get('loadSub').textContent, /--/);
      assertPaused(a);
    }
  }
});

test('null, empty, booleans and nonfinite measurements never become zero', () => {
  const a = app();
  for (const bad of [null, undefined, '', ' ', true, false, NaN, Infinity, -Infinity, 'Infinity', 'NaN', '0x10', [], {}]) {
    assert.equal(a.call('finiteNumber', bad), null, `finiteNumber rejects ${String(bad)}`);
    const health = a.call('getDashboardHealth', data({ power: bad, current: bad }));
    assert.equal(health.power, null);
    assert.equal(health.current, null);
    assert.equal(health.animate, false);
  }
  for (const zero of [0, '0', '0.00']) assert.equal(a.call('finiteNumber', zero), 0);
});

test('cloud errors hide instant values, freeze summary and recover automatically', () => {
  const a = app();
  const original = data();
  a.call('applyDashboardData', original);
  const before = summary(a);
  const health = a.call('getDashboardHealth', original, false, '模擬雲端讀取失敗');
  assert.equal(health.canUseRealtime, false);
  a.call('applyDashboardData', original, false, '模擬雲端讀取失敗');
  assertHidden(a);
  assert.deepEqual(summary(a), before);
  assert.match(a.get('syncStatusText').textContent, /雲端|讀取失敗/);
  const recovered = data({ power: 2.5, current: 11, session_energy: 2.5, month_energy: 580 });
  a.call('applyDashboardData', recovered);
  assert.match(a.get('powerVal').textContent, /^2\.50/);
  assert.match(a.get('sessionEnergy').textContent, /^2\.50/);
  assert.match(a.get('monthEnergy').textContent, /^580\.0/);
  assert.equal(a.get('teslaChargingStage').classList.contains('active'), true);
});

test('first load with no trusted snapshot keeps summary empty', () => {
  for (const overrides of [{ ocpp_connection: 'off' }, { updated_at: NOW - 360000 }]) {
    const a = app();
    a.call('applyDashboardData', data(overrides));
    assertHidden(a);
    for (const id of ['sessionEnergy', 'sessionCost', 'monthEnergy', 'monthCost']) assert.match(a.get(id).textContent, /--/);
  }
});

test('all existing demo scenarios run without real connection/validity/timestamp fields', () => {
  const a = app();
  const scenarios = a.run('DEMO_SCENARIOS');
  assert.ok(scenarios.length >= 4);
  for (const scenario of scenarios) {
    const sample = { ...scenario, power: scenario.basePower, current: scenario.baseCurrent };
    delete sample.ocpp_connection;
    delete sample.power_valid;
    delete sample.current_valid;
    delete sample.updated_at;
    const health = a.call('getDashboardHealth', sample, true);
    assert.equal(health.canUseRealtime, true);
    a.call('applyDashboardData', sample, true);
    assert.doesNotMatch(a.get('powerVal').textContent, /^--/);
    assert.doesNotMatch(a.get('currentVal').textContent, /^--/);
    assert.match(a.get('syncStatusText').textContent, /展示/);
    assert.equal(a.networkCalls(), 0);
  }
});

test('real syncData catch uses cached summary and hides live data without network access', async () => {
  const a = app();
  a.run('isOwnerAuthenticated = true; activeOwnerUid = "test-owner";');
  a.call('applyDashboardData', data());
  const before = summary(a);
  a.run('fetchFirebaseJson = async function () { throw new Error("模擬網路錯誤"); };');
  await a.call('syncData');
  assertHidden(a);
  assert.deepEqual(summary(a), before);
  assert.equal(a.networkCalls(), 0);
  assert.equal(a.timers.at(-1).ms, a.run('CONFIG.realtimeIntervalMs'));
  a.context.__next = data({ power: 1.5, current: 6.6 });
  a.run('fetchFirebaseJson = async function () { return __next; };');
  await a.call('syncData');
  assert.match(a.get('powerVal').textContent, /^1\.50/);
  assert.equal(a.get('teslaChargingStage').classList.contains('active'), true);
});

test('off followed by a cloud error preserves the latest observed OCPP state', async () => {
  const a = app();
  a.run('isOwnerAuthenticated = true; activeOwnerUid = "test-owner";');
  a.context.__next = data();
  a.run('fetchFirebaseJson = async function () { return __next; };');
  await a.call('syncData');
  const before = summary(a);
  a.context.__next = data({ status: 'Available', ocpp_connection: 'off', power: 0, current: 0,
    updated_at: '2026-11-27 10:09:50', session_energy: 0, month_energy: 0 });
  await a.call('syncData');
  assert.match(a.get('ocppStatusText').textContent, /已斷線/);
  a.run('fetchFirebaseJson = async function () { throw new Error("模擬雲端讀取失敗"); };');
  await a.call('syncData');
  assertHidden(a);
  assert.deepEqual(summary(a), before);
  assert.match(a.get('ocppStatusText').textContent, /已斷線/);
  assert.match(a.get('ocppStatusText').textContent, /非即時|上次/);
  assert.match(a.get('syncStatusText').textContent, /雲端讀取錯誤/);
  assert.equal(a.networkCalls(), 0);
});

test('cloud and OCPP health are separate and the existing Taiwan time parser is retained', () => {
  const a = app();
  a.call('applyDashboardData', data({ ocpp_connection: 'off' }));
  assert.match(a.get('syncStatusText').textContent, /雲端同步正常/);
  assert.match(a.get('ocppStatusText').textContent, /已斷線/);
  a.call('applyDashboardData', data({ updated_at: NOW - 360000 }));
  assert.match(a.get('syncStatusText').textContent, /HA 同步逾時/);
  assert.match(a.get('ocppStatusText').textContent, /已連線.*非即時/);
  const expected = Date.parse('2026-11-27T02:09:35Z');
  for (const timestamp of ['2026-11-27 10:09:35', '2026/11/27 10:09:35',
    '2026-11-27T02:09:35Z', '2026-11-27T10:09:35+08:00', expected, expected / 1000]) {
    assert.equal(a.call('parseTimestamp', timestamp), expected);
  }
});

test('history read failure preserves existing records and the polling interval', async () => {
  const a = app();
  a.run('isOwnerAuthenticated = true; activeOwnerUid = "test-owner";');
  a.context.__records = [{ order_id: 'saved-order', energy: 4.5, cost: 22.2 }];
  a.run('allHistoryRecords = __records; renderHistory = function () {}; fetchFirebaseJson = async function () { throw new Error("模擬歷史讀取失敗"); };');
  await a.call('loadHistory');
  assert.equal(a.run('allHistoryRecords'), a.context.__records);
  assert.equal(a.run('historyState.kind'), 'error');
  assert.equal(a.timers.at(-1).ms, a.run('CONFIG.historyIntervalMs'));
  assert.equal(a.networkCalls(), 0);
});

test('owner-session change clears trusted snapshot before entering another mode', () => {
  const a = app();
  a.call('applyDashboardData', data());
  assert.ok(a.run('lastDashboardData'));
  a.run('syncData = async function () {}; loadHistory = async function () {}; populateMonthDropdown = function () {}; renderHistory = function () {}; updateModeUI = function () {};');
  a.call('setOwnerSession', null);
  assert.equal(a.run('lastDashboardData'), null);
  assert.equal(a.run('lastReceivedData'), null);
  assertHidden(a);
});
