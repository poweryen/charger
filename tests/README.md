# Offline dashboard checks

Run from the repository root with Node.js 18 or later.

## Logic and request-error checks

```sh
node --test tests/dashboard-health.test.cjs
```

These checks load the actual inline application script in Node's VM, with an in-memory DOM and mocked cloud reads. They cover connection and freshness states, strict boolean/finite-number handling, independent meter validity, zero values, cumulative-data preservation, fetch-error recovery, session labels, mode changes, and demo behavior. No browser or network connection is required.

## Desktop and mobile rendering

Install Playwright and its Chromium browser once in your development environment:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser-health.cjs
```

To use an existing Playwright installation or Chromium/Chrome executable, set `CHARGER_PLAYWRIGHT` to the module name or absolute module path and `CHARGER_CHROME` to the browser executable. Without these overrides, the script uses the `playwright` package and its bundled Chromium.

The browser checks render the current `index.html` at **1440 × 1000** and **390 × 844**, with 13 scenarios per size: Charging with Bria/n7, Available with valid zero values, OCPP off/unknown/missing, stale data, read error, power/current invalidity, recovery, and both charging demos. They check horizontal overflow, meter visibility, animation state, and loaded vehicle images. Screenshots and `results.json` are written to ignored `test-artifacts/browser/`.

The original `n7.PNG` and `bria.PNG` assets in the repository root are used first. An optional local `tests/fixtures/` copy is supported for a source-only checkout; these fixtures must come from the same repository revision and are not committed. The initial verification used the original assets from `poweryen/charger` commit `d06bd2319e6f8a0ad8db17b4543b00170c728804`.

The test replaces only the startup section in memory, supplies simulated dashboard/history data, and intercepts all browser requests. It serves the page and original car images locally; every other request is blocked, and the test requires zero external request attempts and zero JavaScript page errors. It does not load Firebase Auth, log in, or contact Firebase, Home Assistant, or a charging station. Playwright installation itself may need internet access.

These are desktop Chromium and mobile-viewport checks. They do not establish real-device/iOS Safari behavior, owner authentication, server-side permissions, live HA synchronization, actual OCPP reconnection, or complete charging-cycle acceptance.
