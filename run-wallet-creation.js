#!/usr/bin/env node
/**
 * Run the Jupiter wallet automation FROM VS CODE / a normal terminal.
 * ---------------------------------------------------------------------------
 * You no longer need to copy-paste the script into DevTools. This launcher:
 *
 *   1. uses YOUR OWN Chrome profile (so you are already logged in and your
 *      extensions, bookmarks and history are there), opens it with a
 *      debugging port, and closes it first if it is already running
 *   2. asks for the wallet name / count / seed mode in THIS terminal
 *   3. waits until you are on the wallet screen (it detects the buttons)
 *   4. injects jupiter-wallets.console.js into the page over the DevTools
 *      Protocol and mirrors its console output back into the terminal
 *   5. prints a summary and leaves your browser open so you can back up seeds
 *
 * Which profile is used:
 *   - wallet.local.json (gitignored)  ->  { "browser": "chrome", "profile": "Profile 14" }
 *   - or --profile="Profile 14" / --profile=Syed / --profile=auto (last used)
 *   - --profile=fresh uses the separate .chrome-profile/ instead (old behaviour)
 *
 * Usage (from VS Code: Ctrl+Shift+B, or `npm start`):
 *
 *   npm start
 *   node run-wallet-creation.js
 *   node run-wallet-creation.js --url=https://jup.ag --base=XT --total=100
 *   node run-wallet-creation.js --mode=existing --phrase="word1 word2 ..."
 *   node run-wallet-creation.js --mode=new-each        # own seed per wallet
 *   node run-wallet-creation.js --yes                  # no questions, defaults
 *   node run-wallet-creation.js --profile="Profile 14" # pick the Chrome profile
 *   node run-wallet-creation.js --profile=fresh        # separate profile
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

/* Optional per-machine settings, gitignored, so each PC can remember its own
 * browser/profile without hardcoding it in the repo:
 *     { "browser": "chrome", "profile": "Profile 14" }
 */
const localCfg = readJsonFile(join(HERE, 'wallet.local.json')) || {};

const cfg = {
  url: cli.url || process.env.JUP_WALLET_URL || localCfg.url || 'https://jup.ag',
  baseName: cli.base || process.env.JUP_BASE_NAME || localCfg.baseName || 'XT',
  total: toInt(cli.total ?? process.env.JUP_TOTAL ?? localCfg.total, 100),
  startIndex: toInt(cli.start ?? process.env.JUP_START_INDEX ?? localCfg.startIndex, 1),
  seedMode: normalizeMode(cli.mode || process.env.JUP_SEED_MODE || localCfg.seedMode || 'new'),
  seedPhrase: cli.phrase || process.env.JUP_SEED_PHRASE || localCfg.seedPhrase || '',
  port: toInt(cli.port, 9222),
  headless: truthy(cli.headless) || process.env.JUP_HEADLESS === '1',
  closeBrowser: truthy(cli.close),
  assumeYes: truthy(cli.yes),

  /* which browser + which of YOUR profiles to drive */
  browserChoice: String(cli.browser || process.env.JUP_BROWSER || localCfg.browser || 'auto').toLowerCase(),
  profileChoice: String(cli.profile || process.env.JUP_CHROME_PROFILE || localCfg.profile || 'auto'),
  userDataOverride: String(cli['user-data'] || process.env.JUP_USER_DATA || localCfg.userData || ''),
  allowClosingBrowser: !truthy(cli['no-close-chrome']),

  waitForWalletUiMs: toInt(cli.waitmin, 10) * 60_000,
  profileDir: join(HERE, '.chrome-profile'), // only used by --profile=fresh
};

/* Set once the user's real profile is launched, so an error message can still
 * remind them that a debugging-enabled browser window is left open. */
let personalBrowserOpen = false;

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
const fail = (msg) => {
  console.error('\n  X ' + msg + '\n');
  if (personalBrowserOpen) {
    console.error('  ! Your browser is still open with a debugging port — close that window when you are done.\n');
  }
  process.exit(1);
};

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** One-off terminal question (readline is opened and closed per use). */
async function askLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Run a command without showing its output; resolves true on exit code 0. */
function runCommand(file, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Command lines can quote the path, so compare without quotes. */
function normalizeCmdLine(text) {
  return String(text || '').toLowerCase().replace(/"/g, '');
}

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
/* 4. Browser + profile selection (drives YOUR real browser profile)          */
/* ========================================================================== */

const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || '';

const CHROMIUM_BROWSERS = [
  {
    key: 'chrome',
    name: 'Google Chrome',
    image: 'chrome.exe',
    userData: LOCAL_APP_DATA ? join(LOCAL_APP_DATA, 'Google', 'Chrome', 'User Data') : '',
    exe: [
      process.env.CHROME_PATH,
      join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      LOCAL_APP_DATA && join(LOCAL_APP_DATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean),
  },
  {
    key: 'edge',
    name: 'Microsoft Edge',
    image: 'msedge.exe',
    userData: LOCAL_APP_DATA ? join(LOCAL_APP_DATA, 'Microsoft', 'Edge', 'User Data') : '',
    exe: [
      process.env.EDGE_PATH,
      join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      '/usr/bin/microsoft-edge',
    ].filter(Boolean),
  },
];

function resolveBrowser() {
  const installed = CHROMIUM_BROWSERS
    .map((browser) => ({ ...browser, exePath: browser.exe.find((candidate) => existsSync(candidate)) }))
    .filter((browser) => browser.exePath);

  if (!installed.length) fail('No Chrome/Edge found. Set CHROME_PATH to your browser executable.');

  if (cfg.browserChoice !== 'auto') {
    const wanted = installed.find((browser) => browser.key === cfg.browserChoice);
    if (!wanted) fail('--browser=' + cfg.browserChoice + ' is not installed here.');
    return wanted;
  }
  return installed.find((browser) => browser.key === 'chrome') || installed[0];
}

function readLocalState(userData) {
  return readJsonFile(join(userData, 'Local State')) || {};
}

function profileCache(userData) {
  const localState = readLocalState(userData);
  return (localState.profile || {}).info_cache || {};
}

function profileSummary(userData, dirName) {
  const info = profileCache(userData)[dirName] || {};
  const bits = [];
  if (info.name) bits.push(info.name);
  const email = info.user_name || info.gaia_name;
  if (email) bits.push(email);
  return bits.join(' · ');
}

/** "Profile 14", "Syed", an email, or "auto" (last used profile) -> folder. */
function resolveProfileDir(userData, wanted) {
  const localState = readLocalState(userData);
  const cache = profileCache(userData);
  const dirs = Object.keys(cache).filter((dir) => existsSync(join(userData, dir)));
  if (!dirs.length) return 'Default';

  const text = String(wanted || 'auto').trim();
  const lower = text.toLowerCase();
  if (!text || lower === 'auto') {
    const last = (localState.profile || {}).last_used;
    if (last && dirs.includes(last)) return last;
    return dirs.includes('Default') ? 'Default' : dirs[0];
  }

  const exact = dirs.find((dir) => dir.toLowerCase() === lower);
  if (exact) return exact;

  const equals = (value) => String(value || '').toLowerCase() === lower;
  const byField = dirs.find((dir) => {
    const info = cache[dir] || {};
    return [info.name, info.gaia_name, info.user_name, info.gaia_given_name].some(equals);
  });
  if (byField) return byField;

  const partial = dirs.find((dir) => {
    const info = cache[dir] || {};
    return [info.name, info.user_name].some((value) => value && String(value).toLowerCase().includes(lower));
  });
  if (partial) return partial;

  const options = dirs
    .map((dir) => dir + (profileSummary(userData, dir) ? '  (' + profileSummary(userData, dir) + ')' : ''))
    .join('\n      ');
  return fail('No browser profile matches "' + text + '".\n    Available profiles:\n      ' + options);
}

/** Decide between a real profile on disk and the isolated automation profile. */
function resolveTargetProfile(browser) {
  if (String(cfg.profileChoice).toLowerCase() === 'fresh' || truthy(cli['fresh-profile'])) {
    return {
      fresh: true,
      userData: cfg.profileDir,
      profileDir: null,
      label: 'separate automation profile (.chrome-profile/)',
    };
  }

  const userData = cfg.userDataOverride || browser.userData;
  if (!userData || !existsSync(userData)) {
    fail('Browser profile folder not found: ' + (userData || '(none)') +
      '\n    Use --profile=fresh to use the separate automation profile instead.');
  }

  const profileDir = resolveProfileDir(userData, cfg.profileChoice);
  const summary = profileSummary(userData, profileDir);
  return {
    fresh: false,
    userData,
    profileDir,
    label: profileDir + (summary ? ' — ' + summary : ''),
  };
}

/* --- closing a browser that is already running ---------------------------- */

function runPowerShell(script) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out));
  });
}

/** ProcessId + CommandLine for the browser, or null if we cannot ask. */
async function listBrowserProcesses(browser) {
  if (process.platform !== 'win32') return null;
  const script = `$p = Get-CimInstance Win32_Process -Filter "Name='${browser.image}'" | Select-Object ProcessId,CommandLine; if ($p) { $p | ConvertTo-Json -Compress }`;
  const out = await runPowerShell(script);
  if (!out) return [];
  const text = out.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function countProcessesByImage(browser) {
  if (process.platform !== 'win32') return 0;
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('tasklist', ['/FI', 'IMAGENAME eq ' + browser.image, '/NH'], { windowsHide: true });
    } catch {
      resolve(0);
      return;
    }
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const escaped = browser.image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resolve((out.match(new RegExp(escaped, 'gi')) || []).length);
    });
  });
}

/**
 * A browser UI cannot gain a debugging port after it started, so a personal
 * profile means closing the browser once and letting the launcher reopen it.
 * Only when the target is the browser's DEFAULT user-data-dir is it safe to
 * close every instance (normal launches carry no --user-data-dir flag).
 * With --user-data=<other folder> only instances opened on that folder close.
 */
async function stopBrowserIfRunning(browser, target) {
  const processes = await listBrowserProcesses(browser);
  const personal = target.fresh === false;
  const matchesTarget = (proc) => normalizeCmdLine(proc.CommandLine)
    .includes('--user-data-dir=' + normalizeCmdLine(target.userData));
  const killAllInstances = personal && normalizeCmdLine(target.userData) === normalizeCmdLine(browser.userData);

  let relevant = [];
  if (processes !== null) {
    relevant = killAllInstances ? processes : processes.filter(matchesTarget);
  }

  let running = relevant.length;
  if (processes === null) {
    if (!killAllInstances) {
      warn('Could not inspect running ' + browser.name + ' processes; skipping the close step.');
      return;
    }
    running = await countProcessesByImage(browser);
  }
  if (!running) return;

  log('');
  if (killAllInstances) {
    log('  ' + browser.name + ' is running. It must be fully closed once so the');
    log('  automation can reopen it with a debugging port on YOUR profile.');
    log('  ' + browser.name + ' restores your tabs when it reopens.');
  } else if (personal) {
    log('  ' + browser.name + ' is still running on that profile folder; closing just that instance.');
  } else {
    log('  An old automation ' + browser.name + ' is still running with the separate profile.');
  }

  if (!cfg.allowClosingBrowser) {
    fail('Close ' + browser.name + ' completely, then run this again (or drop --no-close-chrome).');
  }
  if (process.stdin.isTTY && !cfg.assumeYes) {
    const answer = (await askLine('  Close ' + browser.name + ' now? [Y/n] ')).trim().toLowerCase();
    if (answer && answer !== 'y' && answer !== 'yes') {
      fail('Cancelled. Close ' + browser.name + ' yourself, then run this again.');
    }
  }

  if (killAllInstances) {
    await runCommand('taskkill', ['/IM', browser.image, '/T', '/F']);
  } else {
    for (const proc of relevant) {
      if (proc && proc.ProcessId) await runCommand('taskkill', ['/PID', String(proc.ProcessId), '/T', '/F']);
    }
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const left = await listBrowserProcesses(browser);
    if (left === null) break;
    const remaining = killAllInstances ? left.length : left.filter(matchesTarget).length;
    if (!remaining) break;
    await sleep(250);
  }
  await sleep(600);
  log('  ' + (killAllInstances ? browser.name : 'That browser instance') + ' closed.');
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

  /* --- browser + your profile -------------------------------------------- */
  const browser = resolveBrowser();
  const profile = resolveTargetProfile(browser);

  log('');
  log('  Browser:    ' + browser.name + '  (' + browser.exePath + ')');
  log('  Profile:    ' + profile.label);
  if (!profile.fresh) log('              ' + profile.userData);

  let spawned = null;
  if (await cdpIsUp()) {
    log('\n  Reusing the browser already listening on port ' + cfg.port + '.');
  } else {
    await stopBrowserIfRunning(browser, profile);

    if (cfg.headless) {
      log('\n  Starting a headless browser on port ' + cfg.port + '.');
    } else {
      log('\n  Opening ' + browser.name + ' with that profile ...');
    }

    mkdirSync(profile.userData, { recursive: true });
    const args = [
      '--remote-debugging-port=' + cfg.port,
      '--user-data-dir=' + profile.userData,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (profile.profileDir) args.push('--profile-directory=' + profile.profileDir);
    if (cfg.headless) args.push('--headless=new', '--disable-gpu');
    args.push(cfg.url);

    spawned = spawn(browser.exePath, args, { detached: true, stdio: 'ignore' });
    spawned.unref?.();
    if (!profile.fresh) personalBrowserOpen = true;

    if (!(await waitForCdp(cfg.headless ? 45_000 : 60_000))) {
      fail('The browser did not expose its DevTools port.\n' +
        '    Close every ' + browser.name + ' window (including background apps) and try again,\n' +
        '    or pass --port=9223. If this keeps happening, run with --profile=fresh.');
    }

    if (!profile.fresh) {
      log('  ' + browser.name + ' reopened with your profile.');
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
    if (!cfg.headless) log('  This is your own browser profile, so the login is remembered.');
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

  if (!profile.fresh) {
    log('  This window is YOUR ' + browser.name + ' profile, opened with a debugging port.');
  }
  if (cfg.closeBrowser) {
    if (spawned) {
      killTree(spawned.pid);
      log('  Browser closed. Start ' + browser.name + ' normally again when you need it.');
    } else {
      log('  Browser left open — it was already running before this launcher started.');
    }
  } else {
    log('  Browser left open. Back up the seed phrase, then close that window — the');
    log('  debugging port disappears with it and ' + browser.name + ' starts normally next time.');
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
  if (personalBrowserOpen) {
    console.log('  It is running with a debugging port — close that window when you are done.');
  }
  process.exit(130);
});

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
