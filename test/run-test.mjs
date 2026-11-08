/**
 * Headless-Chrome smoke test for jupiter-wallets.console.js
 * ---------------------------------------------------------------------------
 * Runs the REAL console script against test/mock-wallet.html over the Chrome
 * DevTools Protocol, and asserts that:
 *   - wallets are created with the expected names
 *   - the generated seed phrase is captured and reused for the later wallets
 *   - a decoy button is never clicked and the dashboard search box is untouched
 *
 * Run:  node test/run-test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || '';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  LOCAL_APP_DATA && join(LOCAL_APP_DATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const here = import.meta.dirname;
const SCRIPT = readFileSync(resolve(here, '..', 'jupiter-wallets.console.js'), 'utf8');
const MOCK_URL = pathToFileURL(resolve(here, 'mock-wallet.html')).href;

/* ---------------------------------------------------------------- CDP glue */
function connect(wsUrl) {
  return new Promise((resolveConn, rejectConn) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;

    ws.addEventListener('open', () => {
      resolveConn({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = (nextId += 1);
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, handler) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(handler);
        },
        close() { try { ws.close(); } catch { /* ignore */ } },
      });
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.method && listeners.has(msg.method)) {
        for (const handler of listeners.get(msg.method)) {
          try { handler(msg.params); } catch { /* ignore */ }
        }
      }
      if (!msg.id || !pending.has(msg.id)) return;
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter.rej(new Error(msg.error.message + ' (' + msg.error.code + ')'));
      else waiter.res(msg.result);
    });

    ws.addEventListener('error', () => rejectConn(new Error('CDP socket failed')));
  });
}

const describeArg = (arg) => {
  if (!arg) return '';
  if ('value' in arg) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  return arg.description || arg.type || '';
};

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    userGesture: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error('page threw: ' + detail);
  }
  return result.result.value;
}

async function waitForDevTools() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up on port ' + PORT);
}

async function newTab() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(MOCK_URL)}`, { method: 'PUT' });
  if (!res.ok) throw new Error('could not open a tab: ' + res.status);
  return await res.json();
}

async function closeTab(id) {
  try { await fetch(`http://127.0.0.1:${PORT}/json/close/${id}`); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------- tests */
async function runScenario(label, config, expect) {
  const tab = await newTab();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  const logs = [];
  cdp.on('Runtime.consoleAPICalled', (params) => {
    logs.push(params.type + ': ' + (params.args || []).map(describeArg).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {};
    logs.push('EXCEPTION: ' + (details.exception?.description || details.text));
  });

  // wait until the mock page itself is ready
  const ready = Date.now() + 15000;
  while (Date.now() < ready) {
    const state = await evaluate(cdp, 'document.readyState');
    if (state === 'complete' && (await evaluate(cdp, '!!window.__test'))) break;
    await sleep(150);
  }

  const injection = `(function () {
    window.JUP_WALLETS_CONFIG = ${JSON.stringify(config)};
    ${SCRIPT}
  })();`;
  await evaluate(cdp, injection);

  // poll the page until the run reports itself finished
  const deadline = Date.now() + 120000;
  let snapshot = null;
  while (Date.now() < deadline) {
    const raw = await evaluate(cdp, `JSON.stringify({
      status: window.jupiterWallets ? window.jupiterWallets.status() : null,
      test: window.__test,
      dialogs: document.querySelectorAll('[role="dialog"]').length
    })`);
    const parsed = JSON.parse(raw);
    if (parsed.status && parsed.status.running === false) { snapshot = parsed; break; }
    await sleep(250);
  }
  cdp.close();
  await closeTab(tab.id);

  if (!snapshot) throw new Error('[' + label + '] the script never finished within 120s');
  const { status, test } = snapshot;

  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };

  check(status.failed.length === 0, 'failed wallets: ' + JSON.stringify(status.failed));
  check(
    JSON.stringify(status.created) === JSON.stringify(expect.created),
    'created ' + JSON.stringify(status.created) + ' !== expected ' + JSON.stringify(expect.created)
  );
  check(test.created.length === expect.created.length,
    'mock recorded ' + test.created.length + ' created wallets, expected ' + expect.created.length);

  if (expect.importedCount != null) {
    check(test.importedSeeds.length === expect.importedCount,
      'imported ' + test.importedSeeds.length + ' seed phrases, expected ' + expect.importedCount);
  }
  if (expect.allImportedEqual) {
    check(
      test.importedSeeds.every((seed) => seed === expect.allImportedEqual),
      'imported seeds did not all match the expected phrase:\n' + JSON.stringify(test.importedSeeds)
    );
  }
  check(test.decoyClicks === 0, 'the decoy "Create new wallet group" button was clicked');
  check(test.searchTouched === false, 'the dashboard "Search wallets" input was typed into');

  if (failures.length) {
    console.error('FAIL  ' + label);
    for (const failure of failures) console.error('      - ' + failure);
    console.error('      status: ' + JSON.stringify(status));
    console.error('      mock:   ' + JSON.stringify(test));
    console.error('      page console:');
    for (const line of logs.slice(-25)) console.error('        ' + line);
    return false;
  }

  console.log('PASS  ' + label + '  (' + status.created.join(', ') + ')');
  return true;
}

/* -------------------------------------------------------------------- main */
if (!CHROME) {
  console.error('No Chrome/Edge executable found. Set CHROME_PATH and retry.');
  process.exit(1);
}

const startedAt = Date.now();
const userDataDir = mkdtempSync(join(tmpdir(), 'jupwallets-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: 'ignore', detached: true });

let ok = false;
try {
  const version = await waitForDevTools();
  console.log('Chrome ' + version.Browser + ' up on ' + PORT);

  const phrase = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

  const first = await runScenario(
    'NEW seed -> captured and reused',
    { baseName: 'XT', total: 3, seedMode: 'new', stepDelayMs: 300, actionTimeoutMs: 6000, afterCreateDelayMs: 300 },
    {
      created: ['XT01', 'XT02', 'XT03'],
      importedCount: 2,
      allImportedEqual: ['apple', 'brave', 'crisp', 'delta', 'eagle', 'frost',
        'grape', 'humble', 'ivory', 'jolly', 'kite', 'lemon'].join(' '),
    }
  );

  const second = await runScenario(
    'EXISTING seed -> imported for every wallet',
    { baseName: 'EX', total: 2, seedPhrase: phrase, stepDelayMs: 300, actionTimeoutMs: 6000, afterCreateDelayMs: 300 },
    { created: ['EX01', 'EX02'], importedCount: 2, allImportedEqual: phrase }
  );

  const third = await runScenario(
    'NEW seed per wallet -> no seed imports',
    { baseName: 'NW', total: 2, seedMode: 'new', newSeedEachWallet: true, stepDelayMs: 300, actionTimeoutMs: 6000, afterCreateDelayMs: 300 },
    { created: ['NW01', 'NW02'], importedCount: 0 }
  );

  ok = first && second && third;
} catch (error) {
  console.error('ERROR ' + (error && error.stack ? error.stack : error));
} finally {
  try {
    spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* ignore */ }
  await sleep(400);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Chrome may hold locks */ }
}

console.log(ok ? 'ALL TESTS PASSED (' + Math.round((Date.now() - startedAt) / 1000) + 's)' : 'TESTS FAILED');
process.exit(ok ? 0 : 1);
