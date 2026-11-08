#!/usr/bin/env node
/**
 * Run the Jupiter wallet automation FROM VS CODE / a normal terminal.
 * ---------------------------------------------------------------------------
 * You no longer need to copy-paste the script into DevTools. This launcher:
 *
 *   1. opens Chrome/Edge with a dedicated profile (.chrome-profile/, gitignored)
 *   2. asks for the wallet name / count / seed mode in THIS terminal
 *   3. waits until you are on the wallet screen (it detects the buttons)
 *   4. injects jupiter-wallets.console.js into the page over the DevTools
 *      Protocol and mirrors its console output back into the terminal
 *   5. prints a summary and leaves the browser open so you can back up seeds
 *
 * Usage (from VS Code: Ctrl+Shift+B, or `npm start`):
 *
 *   npm start
 *   node run-wallet-creation.js
 *   node run-wallet-creation.js --url=https://jup.ag --base=XT --total=100
 *   node run-wallet-creation.js --mode=existing --phrase="word1 word2 ..."
 *   node run-wallet-creation.js --mode=new-each        # own seed per wallet
 *   node run-wallet-creation.js --yes                  # no questions, defaults
 *   node run-wallet-creation.js --headless --close     # for automated runs
 *
 * Everything is optional — press Enter to accept each default.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_FILE = join(HERE, 'jupiter-wallets.console.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ========================================================================== */
/* 1. Settings: CLI flags > environment variables > defaults                  */
/* ========================================================================== */

const cli = parseArgs(process.argv.slice(2));

const cfg = {
  url: cli.url || process.env.JUP_WALLET_URL || 'https://jup.ag',
  baseName: cli.base || process.env.JUP_BASE_NAME || 'XT',
  total: toInt(cli.total ?? process.env.JUP_TOTAL, 100),
  startIndex: toInt(cli.start ?? process.env.JUP_START_INDEX, 1),
  seedMode: normalizeMode(cli.mode || process.env.JUP_SEED_MODE || 'new'),
  seedPhrase: cli.phrase || process.env.JUP_SEED_PHRASE || '',
  port: toInt(cli.port, 9222),
  headless: truthy(cli.headless) || process.env.JUP_HEADLESS === '1',
  closeBrowser: truthy(cli.close),
  assumeYes: truthy(cli.yes),
  waitForWalletUiMs: toInt(cli.waitmin, 10) * 60_000,
  profileDir: join(HERE, '.chrome-profile'),
};

/* Strings that mean "the wallet screen is ready". If Jupiter renames the
 * buttons, add the new wording here (or pass it in via --ready-hint). */
const READY_HINTS = [
  'create a new wallet', 'create new wallet', 'create a wallet',
  'add new wallet', 'add wallet', 'create wallet',
  'new seed phrase', 'existing seed phrase',
];
if (cli['ready-hint']) READY_HINTS.push(String(cli['ready-hint']).toLowerCase());

if (!existsSync(SCRIPT_FILE)) {
  console.error('\n  X jupiter-wallets.console.js is missing next to this launcher. Pull the repo again.\n');
  process.exit(1);
}

/* ========================================================================== */
/* 2. Small helpers                                                           */
/* ========================================================================== */

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      if (!out.url) out.url = arg; // first bare argument is the URL
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = (eq === -1 ? body : body.slice(0, eq)).toLowerCase();
    out[key] = eq === -1 ? 'true' : body.slice(eq + 1);
  }
  return out;
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function truthy(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y';
}

function normalizeMode(value) {
  const text = String(value || '').toLowerCase();
  if (text === '2' || text === 'existing') return 'existing';
  if (text === '3' || text === 'new-each' || text === 'new-each-wallet' || text === 'unique') return 'new-each';
  return 'new';
}

const pad2 = (value) => String(value).padStart(2, '0');

function modeLabel() {
  if (cfg.seedMode === 'existing') return 'import one seed phrase for every wallet';
  if (cfg.seedMode === 'new-each') return 'generate a separate seed phrase for every wallet';
  return 'generate one seed phrase and reuse it for every wallet';
}

const log = (msg) => console.log(msg);
const warn = (msg) => console.log('  ! ' + msg);
const fail = (msg) => { console.error('\n  X ' + msg + '\n'); process.exit(1); };

/* ========================================================================== */
/* 3. Ask the questions in the TERMINAL (instead of page prompt())            */
/* ========================================================================== */

async function askQuestions() {
  log('\n------------------------------- setup -------------------------------');
  log(' Press Enter to accept the [default] shown for each question.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question, fallback) => {
    const answer = (await rl.question(`  ${question} [${fallback}]: `)).trim();
    return answer || String(fallback);
  };

  try {
    cfg.url = await ask('Wallet page URL', cfg.url);
    cfg.baseName = await ask('Wallet base name', cfg.baseName);
    cfg.total = toInt(await ask('How many wallets in total', cfg.total), cfg.total);
    cfg.startIndex = toInt(await ask('Start from number (resume)', cfg.startIndex), cfg.startIndex);

    log('');
    log('  Seed phrase handling:');
    log('    1) generate one new seed phrase, reuse it for every wallet  (default)');
    log('    2) import my own 12/24-word seed phrase');
    log('    3) generate a separate new seed phrase for every wallet');
    const defaultChoice = cfg.seedMode === 'existing' ? '2' : cfg.seedMode === 'new-each' ? '3' : '1';
    const choice = (await ask('Choose 1 / 2 / 3', defaultChoice)).trim();

    if (choice === '2') {
      cfg.seedMode = 'existing';
      if (!cfg.seedPhrase) {
        log('');
        warn('The phrase is typed in this terminal and echoed on screen.');
        warn('Do not record or share the terminal while you type it.');
        cfg.seedPhrase = (await rl.question('  Paste your seed phrase: ')).trim();
      }
    } else if (choice === '3') {
      cfg.seedMode = 'new-each';
    } else {
      cfg.seedMode = 'new';
    }
  } finally {
    rl.close();
  }

  log('');
  log('  Page:       ' + cfg.url);
  log('  Names:      ' + cfg.baseName + String(cfg.startIndex).padStart(2, '0') +
    ' ... ' + cfg.baseName + String(cfg.total).padStart(2, '0'));
  log('  Seed mode:  ' + modeLabel());
  log('--------------------------------------------------------------------');
}

function validate() {
  if (!cfg.url || !/^https?:\/\/|^file:\/\//i.test(cfg.url)) {
    fail('Wallet page URL looks wrong: "' + cfg.url + '"');
  }
  if (cfg.total < cfg.startIndex) {
    fail('total (' + cfg.total + ') is smaller than the start number (' + cfg.startIndex + ').');
  }
  if (cfg.seedMode === 'existing' && cfg.seedPhrase.trim().split(/\s+/).filter(Boolean).length < 12) {
    fail('The seed phrase you gave has fewer than 12 words.');
  }
}

/** Config object injected as window.JUP_WALLETS_CONFIG inside the page. */
function pageConfig() {
  const out = { baseName: cfg.baseName, total: cfg.total, startIndex: cfg.startIndex };
  if (cfg.seedMode === 'existing') {
    out.seedMode = 'existing';
    out.seedPhrase = cfg.seedPhrase.trim();
  } else if (cfg.seedMode === 'new-each') {
    out.seedMode = 'new';
    out.newSeedEachWallet = true;
  } else {
    out.seedMode = 'new';
  }
  return out;
}

/* ========================================================================== */
/* 4. Find and launch a browser with remote debugging                          */
/* ========================================================================== */

const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || '';

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    LOCAL_APP_DATA && join(LOCAL_APP_DATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const debugBase = () => `http://127.0.0.1:${cfg.port}`;

async function cdpIsUp() {
  try {
    const res = await fetch(debugBase() + '/json/version');
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpIsUp()) return true;
    await sleep(300);
  }
  return false;
}

async function listTargets() {
  const res = await fetch(debugBase() + '/json/list');
  if (!res.ok) throw new Error('cannot list Chrome tabs (' + res.status + ')');
  return await res.json();
}

function targetsUrl(target) {
  try {
    const url = new URL(cfg.url);
    if (url.protocol === 'file:') return target.url.startsWith('file:');
    return target.url.startsWith(url.origin);
  } catch {
    return false;
  }
}

async function openTarget() {
  const pages = (await listTargets()).filter((t) => t.type === 'page');
  const existing = pages.find(targetsUrl);
  if (existing) {
    log('  Browser tab: ' + existing.url);
    return existing;
  }
  const res = await fetch(debugBase() + '/json/new?' + encodeURIComponent(cfg.url), { method: 'PUT' });
  if (!res.ok) throw new Error('could not open a browser tab (' + res.status + ')');
  return await res.json();
}

/* ========================================================================== */
/* 5. Minimal DevTools Protocol client                                        */
/* ========================================================================== */

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;

    ws.addEventListener('open', () => {
      resolve({
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

    ws.addEventListener('error', () => reject(new Error('could not connect to the browser tab')));
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    userGesture: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

const describeArg = (arg) => {
  if (!arg) return '';
  if ('value' in arg) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  return arg.description || arg.type || '';
};

const CSS_STYLE_ARG = /^\s*(color|background|font|padding|border|display|margin)\s*:/i;

/** Flatten one console call: '%c[tag]%c message' + style args -> clean text. */
function describeConsoleCall(params) {
  const parts = (params.args || []).map(describeArg);
  if (parts.length && parts[0].includes('%c')) {
    return [parts[0].replace(/%c/g, '')]
      .concat(parts.slice(1).filter((part) => !CSS_STYLE_ARG.test(part)))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return parts.join(' ');
}

/** Print everything the injected page script logs, in this terminal. */
function relayPageLogs(cdp) {
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const text = describeConsoleCall(params);
    if (!text) return;
    console.log('  ' + text);
  });

  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {};
    console.error('  page error: ' + (details.exception?.description || details.text));
  });
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch { /* page is navigating; retry */ }
    await sleep(300);
  }
  if (label) warn('timed out waiting for ' + label);
  return false;
}

/* ========================================================================== */
/* 6. Main                                                                    */
/* ========================================================================== */

async function main() {
  log('');
  log('  Jupiter Wallet Automation — VS Code runner');
  log('  ==========================================');

  if (!cfg.assumeYes && process.stdin.isTTY) {
    await askQuestions();
  } else {
    log('');
    log('  No interactive terminal, so the defaults / flags are used:');
    log('    page:      ' + cfg.url);
    log('    names:     ' + cfg.baseName + pad2(cfg.startIndex) + ' ... ' + cfg.baseName + pad2(cfg.total));
    log('    seed mode: ' + modeLabel());
    log('  (run `node run-wallet-creation.js` in the VS Code terminal to answer questions)');
  }
  validate();

  /* --- browser ---------------------------------------------------------- */
  const browser = findBrowser();
  if (!browser) fail('No Chrome/Edge found. Set CHROME_PATH to your browser executable.');

  let spawned = null;
  if (await cdpIsUp()) {
    log('\n  Reusing the automation browser already listening on port ' + cfg.port + '.');
  } else {
    if (cfg.headless) {
      log('\n  Starting a headless browser on port ' + cfg.port + '.');
    } else {
      log('\n  Opening ' + browser.split(/[\\/]/).pop() + ' with its own profile (first run: log in there).');
    }
    mkdirSync(cfg.profileDir, { recursive: true });
    const args = [
      '--remote-debugging-port=' + cfg.port,
      '--user-data-dir=' + cfg.profileDir,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (cfg.headless) args.push('--headless=new', '--disable-gpu');
    args.push(cfg.url);

    spawned = spawn(browser, args, { detached: true, stdio: 'ignore' });
    spawned.unref?.();

    if (!(await waitForCdp(45_000))) {
      fail('The browser did not expose its DevTools port. Close all Chrome windows and try again.');
    }
  }

  const target = await openTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  relayPageLogs(cdp);

  /* --- wait until the user is on the wallet screen ----------------------- */
  await waitFor(cdp, `document.readyState === 'complete'`, 60_000, 'the page to load');

  const readyExpression = `(function () {
    var text = ((document.body && document.body.innerText) || '').toLowerCase();
    var hints = ${JSON.stringify(READY_HINTS)};
    for (var i = 0; i < hints.length; i += 1) { if (text.indexOf(hints[i]) !== -1) return true; }
    return false;
  })()`;

  if (!(await evaluate(cdp, readyExpression))) {
    log('');
    log('  Waiting for the wallet screen ... (Ctrl+C to cancel)');
    log('  In the browser window: log in and open the page with "Create a new wallet".');
    if (!cfg.headless) log('  Your login is remembered in .chrome-profile/ for next time.');
    log('');

    const deadline = Date.now() + cfg.waitForWalletUiMs;
    let ticks = 0;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = await evaluate(cdp, readyExpression);
      } catch { /* page navigating */ }
      if (ready) break;
      ticks += 1;
      if (ticks % 20 === 0) {
        log('    still waiting ... (' + Math.round((cfg.waitForWalletUiMs - (deadline - Date.now())) / 1000) + 's)');
      }
      await sleep(500);
    }
    if (!ready) {
      fail('The wallet screen never appeared. Check the URL (' + cfg.url + ') and that you are logged in.');
    }
    log('  Wallet screen detected. Starting.');
  }

  /* --- inject the automation -------------------------------------------- */
  const alreadyRunning = await evaluate(cdp, 'window.__jupWalletsRunning === true');
  if (alreadyRunning) {
    fail('A previous run is still active in that tab. Reload the page (Ctrl+R) and run again.');
  }

  const scriptSource = readFileSync(SCRIPT_FILE, 'utf8');
  const injection = `(function () {\nwindow.JUP_WALLETS_CONFIG = ${JSON.stringify(pageConfig())};\n${scriptSource}\n})();`;

  log('');
  log('  ------------------------------------------------------------------');
  await evaluate(cdp, injection);
  log('  ------------------------------------------------------------------');

  /* --- follow the run until it finishes ---------------------------------- */
  const walletCount = Math.max(1, cfg.total - cfg.startIndex + 1);
  const deadline = Date.now() + walletCount * 90_000 + 120_000;
  let lastCount = -1;
  let snapshot = null;

  while (Date.now() < deadline) {
    let status = null;
    try {
      status = JSON.parse(await evaluate(cdp, `JSON.stringify(
        window.jupiterWallets ? window.jupiterWallets.status() : null
      )`));
    } catch { /* page navigating */ }

    if (status) {
      const done = status.created.length + status.skipped.length + status.failed.length;
      if (done !== lastCount) {
        lastCount = done;
        log('  progress: ' + done + '/' + walletCount +
          '  (created ' + status.created.length + ', skipped ' + status.skipped.length + ', failed ' + status.failed.length + ')');
      }
      if (status.running === false) { snapshot = status; break; }
    }
    await sleep(1000);
  }

  /* --- summary ----------------------------------------------------------- */
  log('');
  log('  ============================== summary =============================');
  if (!snapshot) {
    warn('The run did not finish (timeout). Check the browser window for the current state.');
    if (spawned && cfg.closeBrowser) killTree(spawned.pid);
    process.exitCode = 1;
    return;
  }

  log('  Created: ' + snapshot.created.length +
    (snapshot.created.length ? '  (' + snapshot.created.join(', ') + ')' : ''));
  log('  Skipped: ' + snapshot.skipped.length +
    (snapshot.skipped.length ? '  (' + snapshot.skipped.join(', ') + ')' : ''));
  log('  Failed:  ' + snapshot.failed.length +
    (snapshot.failed.length ? '  (' + snapshot.failed.join(', ') + ')' : ''));

  if (snapshot.failed.length) {
    log('');
    warn('Resume from the next number without re-creating the finished wallets:');
    log('      node run-wallet-creation.js --base=' + cfg.baseName +
      ' --start=' + nextNumber(snapshot) + ' --mode=' + cfg.seedMode);
  }

  log('');
  if (cfg.seedMode !== 'new-each') {
    log('  The seed phrase is shown only in the browser window — back it up there now.');
  } else {
    log('  Each wallet has its own seed phrase — back them up from the browser UI.');
  }

  if (cfg.closeBrowser) {
    if (spawned) {
      killTree(spawned.pid);
      log('  Browser closed.');
    } else {
      log('  Browser left open — it was already running before this launcher started.');
    }
  } else {
    log('  Browser left open. Close that window yourself when you are done.');
    log('  (It runs with a local DevTools port, so do not leave it open forever.)');
  }
}

function nextNumber(status) {
  const created = status.created.map((name) => Number.parseInt(String(name).replace(/^\D+/, ''), 10));
  const failed = status.failed.map((name) => Number.parseInt(String(name).replace(/^\D+/, ''), 10));
  const reached = created.concat(failed).filter((n) => Number.isFinite(n));
  return reached.length ? Math.max.apply(null, reached) + 1 : cfg.startIndex;
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* ignore */ }
}

/* ========================================================================== */

process.on('SIGINT', () => {
  console.log('\n  Cancelled. The browser window (if it was opened) is left as-is.');
  process.exit(130);
});

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
