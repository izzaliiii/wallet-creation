/* ============================================================================
 * Jupiter Wallet — Batch Wallet Creator  (DevTools Console script)
 * ----------------------------------------------------------------------------
 * WHERE THIS RUNS
 *   This is browser code. It talks to the real page through `document`, so it
 *   must run inside DevTools on the Jupiter wallet tab — NOT in Node/VSCode's
 *   terminal. VS Code is only the editor here (see README.md for the exact
 *   copy/paste or Snippets workflow).
 *
 * WHAT IT DOES
 *   For i = startIndex..total it:
 *     1. clicks "Create a new wallet"
 *     2. picks "New Seed Phrase" (first wallet only, if you choose NEW) or
 *        "Existing Seed Phrase" (all other wallets)
 *     3. fills the seed phrase / captures the freshly generated one
 *     4. fills the wallet name  ->  baseName + zero-padded index  (XT01, XT02)
 *     5. clicks Next / Confirm / Create and waits until the wallet is created
 *
 * FIRST RUN RECOMMENDATION
 *   Set a small test batch before the 100 run:
 *       window.JUP_WALLETS_CONFIG = { total: 2, baseName: 'XTTEST' };
 *   then paste/run this file. Delete the two test wallets, then run for real.
 *
 * STOP ANY TIME
 *   window.jupiterWallets.stop()      // finishes the current wallet, then stops
 *                                   // or just press Esc / reload the tab
 *
 * SECURITY
 *   A seed phrase can give full control of the wallets. This script keeps it in
 *   this tab's memory only and NEVER writes it to storage or network. It is
 *   however visible in this console, so do not screen-share / record / paste
 *   logs while it runs, and close DevTools before leaving.
 * ==========================================================================*/

/* BROWSER-ONLY GUARD — do NOT run this with Node / VS Code's Run button.
 * Node has no window / document / prompt, so the only thing running it there
 * could produce is "ReferenceError: prompt is not defined". This guard is a
 * no-op in the browser and prints instructions under Node instead. */
if (typeof window === 'undefined' || typeof document === 'undefined') {
  console.error([
    '',
    '  Jupiter wallet script — this is BROWSER code, not Node code.',
    '',
    '  Node has no window / document / prompt, so VS Code\'s Run button cannot',
    '  execute it. Run it inside Chrome/Edge DevTools on the wallet page:',
    '',
    '    1. Open the Jupiter wallet page in Chrome/Edge and log in.',
    '    2. Press F12  ->  Console tab.',
    '    3. First time only: type   allow pasting   and press Enter.',
    '    4. Open this file in VS Code: Ctrl+A, Ctrl+C.',
    '    5. Click into the Console: Ctrl+V, then Enter.',
    '',
    '  Faster: Ctrl+Shift+B -> "Jupiter: copy console script to clipboard".',
    '  Or run the browser test instead:  npm test',
    '',
  ].join('\n'));
  if (typeof process !== 'undefined' && typeof process.exit === 'function') process.exit(0);
}

(function jupiterWalletBatchCreator() {
  'use strict';

  if (window.__jupWalletsRunning) {
    console.warn('[Jupiter-Wallets] Already running in this tab. Call window.jupiterWallets.stop() first.');
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* 1. CONFIG                                                              */
  /* ---------------------------------------------------------------------- */

  const DEFAULT_LABELS = {
    createWallet: [
      'Create a new wallet', 'Create new wallet', 'Create a wallet',
      'Create another wallet', 'Add new wallet', 'Add wallet', 'New wallet',
      'Create Wallet',
    ],
    newSeed: [
      'New Seed Phrase', 'New seed phrase', 'Create New Seed Phrase',
      'Generate New Seed Phrase', 'New recovery phrase',
    ],
    existingSeed: [
      'Existing Seed Phrase', 'Existing seed phrase', 'Import Existing Seed Phrase',
      'Use Existing Seed Phrase', 'Import Existing Wallet', 'Import wallet', 'Import',
    ],
    revealSeed: [
      'Reveal Seed Phrase', 'Reveal seed phrase', 'Reveal Recovery Phrase',
      'Show Seed Phrase', 'Reveal Seed', 'Reveal',
    ],
    seedAction: [
      'Continue', 'Next', 'Import', 'Import Wallet', 'Restore', 'Confirm',
    ],
    seedCheckbox: [
      'I have saved my seed phrase', 'I saved my seed phrase',
      'I have written it down', 'I have backed up my seed phrase',
      'I saved it', 'I have saved it',
    ],
    nameAction: [
      'Next', 'Confirm', 'Create Wallet', 'Create wallet', 'Add Wallet',
      'Continue', 'Save', 'Done',
    ],
    dismissExtras: [
      'Done', 'Got it', 'Finish', 'Go to wallet', 'Open Wallet', 'View Wallet',
    ],
  };

  const userCfg = window.JUP_WALLETS_CONFIG || {};
  const labels = Object.assign({}, DEFAULT_LABELS, userCfg.labels || {});

  const cfg = Object.assign({
    baseName: '',              // '' -> asks you with prompt() (default suggestion XT)
    total: 100,                // wallets to create
    startIndex: 1,             // resume from this number if a run broke halfway
    pad: 2,                    // XT01 ... XT100
    seedPhrase: '',            // put a phrase here to skip the seed prompt
    seedMode: '',              // '' -> ask, 'new' -> generate+reuse, 'existing' -> import seedPhrase
    newSeedEachWallet: false,  // true -> every wallet generates its OWN seed phrase
                               //         (use this if reused seeds give duplicate addresses)
    nameSelector: '',          // optional CSS selector if the name field is not auto-detected
    seedSelector: '',          // optional CSS selector for a seed-phrase textarea
    stepDelayMs: 1200,         // polite pause after each UI action
    actionTimeoutMs: 12000,    // how long to wait for each button / field
    afterCreateDelayMs: 2500,  // pause between wallets
    stopOnError: true,         // false -> skip a broken wallet and continue
    skipExistingNames: true,   // skip names already visible in the wallet list
  }, userCfg);
  cfg.labels = labels;
  cfg.total = Math.max(0, Math.floor(Number(cfg.total)) || 0);
  cfg.startIndex = Math.max(1, Math.floor(Number(cfg.startIndex)) || 1);
  cfg.pad = Math.max(2, Math.floor(Number(cfg.pad)) || 2);
  cfg.stepDelayMs = Math.max(200, Number(cfg.stepDelayMs) || 0);
  cfg.actionTimeoutMs = Math.max(3000, Number(cfg.actionTimeoutMs) || 0);
  cfg.afterCreateDelayMs = Math.max(300, Number(cfg.afterCreateDelayMs) || 0);

  /* ---------------------------------------------------------------------- */
  /* 2. SMALL UTILITIES                                                     */
  /* ---------------------------------------------------------------------- */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => Date.now();
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();

  const log = (msg) => console.log('%c[Jupiter-Wallets]%c ' + msg, 'color:#14b8a6;font-weight:700', 'color:inherit');
  const warn = (msg) => console.warn('%c[Jupiter-Wallets]%c ' + msg, 'color:#f59e0b;font-weight:700', 'color:inherit');
  const err = (msg) => console.error('%c[Jupiter-Wallets]%c ' + msg, 'color:#ef4444;font-weight:700', 'color:inherit');

  function isVisible(el) {
    if (!el || !el.isConnected || !(el instanceof Element)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (!el.getClientRects().length) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/\bdisabled\b/.test(cls)) return true;
    return false;
  }

  /* --- modals ----------------------------------------------------------- */

  const STRONG_SCOPE_SELECTOR = '[role="dialog"], dialog, [aria-modal="true"]';
  const WEAK_SCOPE_SELECTOR = [
    '[class*="modal" i]', '[class*="dialog" i]', '[class*="sheet" i]',
    '[class*="drawer" i]',
  ].join(',');

  const areaOf = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height;
  };

  function activeScope() {
    // 1) real dialogs first (radix / headlessui / MUI all set role="dialog")
    const strong = Array.from(document.querySelectorAll(STRONG_SCOPE_SELECTOR)).filter(isVisible);
    if (strong.length) {
      strong.sort((a, b) => areaOf(a) - areaOf(b)); // innermost dialog wins
      return strong[0];
    }

    // 2) class-name fallback: never pick a tiny "modal-title" style node —
    //    only containers that actually hold a control, and take the biggest one
    const weak = Array.from(document.querySelectorAll(WEAK_SCOPE_SELECTOR))
      .filter((el) => isVisible(el) && el.querySelector('input, textarea, button, [role="button"], [role="checkbox"]'));
    if (weak.length) {
      weak.sort((a, b) => areaOf(b) - areaOf(a));
      return weak[0];
    }

    return document.body;
  }

  const scopeOf = (el) => {
    try {
      return el.closest(STRONG_SCOPE_SELECTOR) || el.closest(WEAK_SCOPE_SELECTOR) || activeScope();
    } catch (_) {
      return activeScope();
    }
  };

  /* ---------------------------------------------------------------------- */
  /* 3. FINDING + CLICKING THINGS BY THEIR TEXT                             */
  /* ---------------------------------------------------------------------- */

  const TEXT_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]', '[role="tab"]', 'a',
    'label', 'input[type="submit"]', 'input[type="button"]',
    'h1', 'h2', 'h3', 'h4', 'h5', 'span', 'p', 'li', 'strong', 'b', 'div',
  ].join(',');

  const NATIVE_CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="tab"], a, label, input[type="submit"], input[type="button"]';

  function clickableTarget(el) {
    const native = el.closest(NATIVE_CLICKABLE);
    if (native) return native;
    let node = el;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth += 1) {
      try {
        if (getComputedStyle(node).cursor === 'pointer') return node;
      } catch (_) { /* ignore */ }
      node = node.parentElement;
    }
    return el;
  }

  function attrHay(el) {
    return lower([
      el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), el.getAttribute('autocomplete'),
      el.getAttribute('data-testid'), el.getAttribute('title'),
      typeof el.className === 'string' ? el.className : '',
    ].filter(Boolean).join(' '));
  }

  /**
   * A checkbox / switch that is already ticked must never be clicked again,
   * otherwise the loop would toggle "I have saved my seed phrase" off and on
   * forever and the Continue button would keep flapping between enabled/disabled.
   */
  function isAlreadyOn(target) {
    if (!(target instanceof Element)) return false;
    const label = target.closest('label');
    const control = label ? label.control : null;
    if (control && (control.type === 'checkbox' || control.type === 'radio')) return !!control.checked;
    if (target.tagName === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio')) return !!target.checked;
    const role = target.getAttribute('role');
    if (role === 'checkbox' || role === 'switch') return target.getAttribute('aria-checked') === 'true';
    return false;
  }

  /**
   * Returns matches for a list of words/phrases, best first.
   * Prefers exact label matches, then buttons, then the shortest label
   * (which means the *inner* element, not a big wrapping <div>).
   */
  function findMatches(words, options) {
    const opts = options || {};
    const exactOnly = !!opts.exact;
    const root = opts.root || activeScope();
    const wanted = (Array.isArray(words) ? words : [words]).map(lower).filter(Boolean);
    if (!wanted.length) return [];

    const nodes = root.querySelectorAll(TEXT_SELECTOR);
    const byTarget = new Map();

    for (const el of nodes) {
      // skip big wrappers; text lives in the leaf-ish elements anyway
      if (el.tagName === 'DIV' && el.children.length > 3) continue;
      if (el.tagName === 'SPAN' && el.children.length > 3) continue;

      // icon-only buttons carry their label in aria-label / title, and
      // <input type="submit"> has neither textContent nor children
      const candidates = [];
      const push = (raw) => {
        const value = norm(raw);
        if (value && value.length <= 120 && !candidates.includes(value)) candidates.push(value);
      };
      push(el.textContent);
      push(el.getAttribute('aria-label'));
      push(el.getAttribute('title'));
      if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) push(el.value);
      if (!candidates.length) continue;

      let best = null;
      for (let i = 0; i < wanted.length; i += 1) {
        const want = wanted[i];
        for (const label of candidates) {
          const labelLower = label.toLowerCase();
          const isExact = labelLower === want;
          if (exactOnly && !isExact) continue;
          if (!isExact && !labelLower.includes(want)) continue;
          if (!isVisible(el) || isDisabled(el)) continue;

          const target = clickableTarget(el);
          if (!target || isDisabled(target)) continue;
          if (isAlreadyOn(target)) continue;

          let score = (isExact ? 1000 : 560) - Math.min(labelLower.length, 160) * 2 - i * 55;
          if (target.matches(NATIVE_CLICKABLE)) score += 300;
          else score += 60;
          if (!best || score > best.score) best = { target, score, label, want, exact: isExact };
        }
      }
      if (!best) continue;

      const prev = byTarget.get(best.target);
      if (!prev || best.score > prev.score) byTarget.set(best.target, best);
    }

    return Array.from(byTarget.values()).sort((a, b) => b.score - a.score);
  }

  async function clickTarget(target) {
    if (!target || !target.isConnected) return false;
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) { /* ignore */ }
    await sleep(80);
    try { if (typeof target.focus === 'function') target.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    try {
      target.click(); // single click on purpose: never double-create a wallet
      return true;
    } catch (_) {
      const rect = target.getBoundingClientRect();
      const fallback = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (fallback) { fallback.click(); return true; }
      return false;
    }
  }

  /** Click the first label from the list that is currently on screen. */
  async function clickLabels(words, options) {
    const opts = options || {};
    const timeout = opts.timeout == null ? cfg.actionTimeoutMs : opts.timeout;
    const root = opts.root || activeScope();
    const deadline = now() + timeout;

    do {
      let matches = findMatches(words, { root, exact: true });
      if (!matches.length) matches = findMatches(words, { root, exact: false });
      if (matches.length) {
        const ok = await clickTarget(matches[0].target);
        if (ok) return matches[0];
      }
      await sleep(250);
    } while (now() < deadline && !state.stopRequested);

    return null;
  }

  async function waitUntil(fn, timeout) {
    const deadline = now() + (timeout == null ? cfg.actionTimeoutMs : timeout);
    do {
      const value = fn();
      if (value) return value;
      await sleep(220);
    } while (now() < deadline);
    return fn() || null;
  }

  /* ---------------------------------------------------------------------- */
  /* 4. FORM FIELDS (React-safe)                                            */
  /* ---------------------------------------------------------------------- */

  function setNativeValue(el, value) {
    if (!el) return false;
    el.focus();

    if (el.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, value); } catch (_) { /* ignore */ }
      if (!inserted) el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;

    // React / Vue / Svelte all listen for these bubbling events
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Set a value and, if the framework swallowed it, type it character by character. */
  async function fillField(el, value) {
    setNativeValue(el, value);
    await sleep(150);

    const current = el.isContentEditable ? norm(el.textContent) : el.value;
    if (current === value) return true;

    try { el.focus(); } catch (_) { /* ignore */ }
    setNativeValue(el, '');
    let typed = false;
    try { typed = document.execCommand('insertText', false, value); } catch (_) { /* ignore */ }
    if (!typed) {
      for (const ch of value) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        if (!el.isContentEditable) el.value += ch;
        else el.textContent += ch;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    return (el.isContentEditable ? norm(el.textContent) : el.value) === value;
  }

  const normalizeSeed = (text) => norm(text).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const seedWords = (text) => normalizeSeed(text).split(' ').filter(Boolean);
  const wordCount = (text) => seedWords(text).length;

  const isSeedLike = (el) => /(seed|mnemonic|recovery|secret|passphrase|backup|phrase)/.test(attrHay(el));

  function visibleInputs(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable=""]'))
      .filter((el) => isVisible(el) && !isDisabled(el) && (el.type || '').toLowerCase() !== 'hidden');
  }

  function findSeedFields(root) {
    if (cfg.seedSelector) {
      const custom = Array.from(document.querySelectorAll(cfg.seedSelector)).filter((el) => isVisible(el) && !isDisabled(el));
      if (custom.length) return custom;
    }

    const inputs = visibleInputs(root || activeScope());
    const seeded = inputs.filter(isSeedLike);
    if (seeded.length) return seeded;

    // fallback: 12 / 24 single-word boxes, one per word
    const wordBoxes = inputs.filter((el) => el.tagName === 'INPUT' && (el.maxLength === 1 || el.maxLength === 2 || el.size === 1));
    if (wordBoxes.length >= 12) return wordBoxes;
    return [];
  }

  const TEXT_INPUT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'];

  function findNameInput(root) {
    if (cfg.nameSelector) {
      const custom = document.querySelector(cfg.nameSelector);
      if (custom && isVisible(custom) && !isDisabled(custom)) return custom;
    }

    const scope = root || activeScope();
    const inputs = visibleInputs(scope);

    // only real text fields: a checkbox must never be mistaken for the name input
    const nonSeed = inputs.filter((el) => {
      if (isSeedLike(el)) return false;
      if (el.tagName === 'TEXTAREA') return false;
      if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.indexOf((el.type || '').toLowerCase()) !== -1;
      return el.isContentEditable === true;
    });

    const scored = [];
    for (const el of nonSeed) {
      const hay = attrHay(el);
      const strongName = /(wallet[-_\s]?name|name[-_\s]?wallet|walletname)/.test(hay);
      const nameWord = /\bname\b/.test(hay);
      if (!strongName && !nameWord) continue; // "wallet" alone is not a name hint

      let score = strongName ? 100 : 55;
      if (/wallet/.test(hay)) score += 15;
      if (el.value) score += 5;
      scored.push({ el, score });
    }

    scored.sort((a, b) => b.score - a.score);
    if (scored.length) return scored[0].el;

    // last resort: a modal that holds exactly one text field is the name step
    if (scope !== document.body && nonSeed.length === 1) return nonSeed[0];
    return null;
  }

  function fillSeedFields(fields, phrase) {
    const words = seedWords(phrase);
    if (!fields.length || words.length < 12) return false;

    if (fields.length === 1) return setNativeValue(fields[0], words.join(' '));

    if (fields.length >= words.length && fields.length >= 12) {
      fields.slice(0, words.length).forEach((el, i) => setNativeValue(el, words[i]));
      return true;
    }

    // one field, chopped into boxes -> just dump the whole phrase in the first
    return setNativeValue(fields[0], words.join(' '));
  }

  /** Try to read the seed phrase that the app just displayed. */
  function readSeedPhrase() {
    // (a) a textarea / input that already holds the phrase
    for (const el of findSeedFields()) {
      const value = norm(el.value || el.textContent);
      if (wordCount(value) >= 12) return normalizeSeed(value);
    }

    // (b) word chips with data attributes
    const chipNodes = Array.from(document.querySelectorAll('[data-word], [data-seed-word], .seed-word, .mnemonic-word'));
    const chips = chipNodes.filter(isVisible).map((el) => norm(el.textContent)).filter((w) => /^[a-z]{2,12}$/i.test(w));
    if (isSeedCount(chips.length)) return chips.join(' ');

    // (c) leaf elements inside a seed-looking container
    const containers = Array.from(document.querySelectorAll(
      '[class*="seed" i], [class*="mnemonic" i], [class*="phrase" i], [class*="recovery" i], ' +
      '[data-testid*="seed" i], [aria-label*="seed" i], [aria-label*="recovery" i]'
    )).filter(isVisible);

    for (const container of containers) {
      const leaves = Array.from(container.querySelectorAll('span, div, li, p, code'))
        .filter((el) => isVisible(el) && el.children.length === 0 && !el.closest('button, [role="button"]'))
        .map((el) => norm(el.textContent))
        .filter((w) => /^[a-z]{2,12}$/i.test(w));

      if (isSeedCount(leaves.length)) return leaves.join(' ');

      // numbered word chips: <span class="word">apple</span>, [data-word], .chip
      const labelled = Array.from(container.querySelectorAll('[data-word], [class*="word" i], [class*="chip" i]'))
        .filter((el) => isVisible(el) && el.children.length === 0)
        .map((el) => norm(el.textContent))
        .filter((w) => /^[a-z]{2,12}$/i.test(w));
      if (isSeedCount(labelled.length)) return labelled.join(' ');
    }

    return null;
  }

  function isSeedCount(count) {
    return count === 12 || count === 15 || count === 18 || count === 21 || count === 24;
  }

  const maskSeed = (phrase) => {
    const words = seedWords(phrase);
    if (words.length < 2) return '(hidden)';
    return words[0] + ' … ' + words[words.length - 1] + '  (' + words.length + ' words)';
  };

  /* ---------------------------------------------------------------------- */
  /* 5. THE WALLET FLOW                                                     */
  /* ---------------------------------------------------------------------- */

  const state = {
    stopRequested: false,
    running: false,
    created: [],
    skipped: [],
    failed: [],
    capturedSeed: '',
  };

  async function openCreateWallet() {
    let hit = await clickLabels(cfg.labels.createWallet, { timeout: cfg.actionTimeoutMs });
    if (hit) {
      await sleep(cfg.stepDelayMs);
      return true;
    }

    // one retry: the page may still be finishing the previous animation
    warn('"Create a new wallet" not found on the first try, retrying once...');
    await sleep(1500);
    hit = await clickLabels(cfg.labels.createWallet, { timeout: 6000 });
    if (hit) {
      await sleep(cfg.stepDelayMs);
      return true;
    }
    return false;
  }

  function tryCaptureSeed(wallet) {
    if (wallet.phrase) return true;
    const phrase = readSeedPhrase();
    if (!phrase) return false;
    wallet.phrase = phrase;
    state.capturedSeed = phrase;
    log('Seed phrase captured from the screen: ' + maskSeed(phrase));
    return true;
  }

  async function handleSeedStage(wallet) {
    const wantsNewSeed = wallet.mode === 'new';

    for (let guard = 0; guard < 10 && !state.stopRequested; guard += 1) {
      if (findNameInput()) return true;

      const seedFields = findSeedFields();

      /* (a) seed entry screen ------------------------------------------- */
      if (seedFields.length) {
        if (!wallet.seedFilled) {
          if (!wallet.phrase) {
            err('This screen wants a seed phrase but none is available.');
            return false;
          }
          fillSeedFields(seedFields, wallet.phrase);
          wallet.seedFilled = true;
          log('Seed phrase filled in (' + wordCount(wallet.phrase) + ' words).');
          await sleep(500);
        }
        const advanced = await clickLabels(cfg.labels.seedAction, { root: scopeOf(seedFields[0]), timeout: 8000 });
        if (advanced) { await sleep(cfg.stepDelayMs); continue; }
        return false;
      }

      /* (b) "new seed" vs "existing seed" choice ------------------------ */
      if (!wallet.seedTypeChosen) {
        const preferred = wantsNewSeed ? cfg.labels.newSeed : cfg.labels.existingSeed;
        const chosen = await clickLabels(preferred, { timeout: 6000 });
        if (chosen) {
          wallet.seedTypeChosen = true;
          wallet.usedNewSeedScreen = wantsNewSeed;
          log(wantsNewSeed ? 'Chose "New Seed Phrase".' : 'Chose "Existing Seed Phrase".');
          await sleep(cfg.stepDelayMs);
          continue;
        }
      }

      /* (c) reveal the fresh seed phrase -------------------------------- */
      // (a modal may skip the "new vs existing" screen and show the reveal
      //  button straight away, so this is keyed on the mode, not the screen)
      if (wantsNewSeed && !wallet.seedRevealed) {
        wallet.usedNewSeedScreen = true;
        const revealed = await clickLabels(cfg.labels.revealSeed, { timeout: 6000 });
        if (revealed) {
          wallet.seedRevealed = true;
          log('Clicked "Reveal Seed Phrase".');
          await sleep(cfg.stepDelayMs);
          if (!wallet.phrase) await waitUntil(() => tryCaptureSeed(wallet), 10000);
          continue;
        }
      }

      /* (d) make sure the fresh seed is captured before we leave the screen */
      if (wantsNewSeed && !wallet.phrase) tryCaptureSeed(wallet);

      /* (e) continue / tick the "I saved it" checkbox -------------------- */
      const advanced = await clickLabels(
        cfg.labels.seedCheckbox.concat(cfg.labels.seedAction),
        { timeout: 4000 }
      );
      if (advanced) { await sleep(cfg.stepDelayMs); continue; }

      return false;
    }

    return !!findNameInput();
  }

  async function handleNameStage(wallet) {
    const input = await waitUntil(() => findNameInput(), 8000);
    if (!input) {
      err('Wallet-name input not found.');
      return false;
    }

    input.focus();
    const filled = await fillField(input, wallet.name);
    if (!filled) warn('Name field did not report the new value, trying to continue anyway...');
    await sleep(400);

    const ok = await clickLabels(cfg.labels.nameAction, { root: scopeOf(input), timeout: cfg.actionTimeoutMs });
    if (!ok) {
      err('Next / Confirm / Create button not found after typing the name.');
      return false;
    }
    await sleep(cfg.stepDelayMs);
    return true;
  }

  async function waitWalletCreated(wallet) {
    const deadline = now() + Math.max(cfg.actionTimeoutMs, 15000);

    while (now() < deadline && !state.stopRequested) {
      if (findNameInput()) {
        await sleep(350);
        continue;
      }

      // a "wallet ready" screen may need one extra click
      const extra = findMatches(cfg.labels.dismissExtras, { exact: false });
      if (extra.length) {
        await clickTarget(extra[0].target);
        await sleep(cfg.stepDelayMs);
        continue;
      }

      const nameInList = findMatches([wallet.name], { exact: true });
      const createAgain = findMatches(cfg.labels.createWallet, { exact: false });
      if (nameInList.length || createAgain.length) return true;

      // name field is gone for a while -> treat as created
      await sleep(1000);
      if (!findNameInput()) return true;
    }

    return false;
  }

  async function runWallet(index, wallet) {
    log('=== Wallet ' + index + '/' + cfg.total + ': ' + wallet.name + ' ===');

    if (cfg.skipExistingNames && findMatches([wallet.name], { exact: true }).length) {
      log('A wallet named "' + wallet.name + '" is already visible — skipping.');
      state.skipped.push(wallet.name);
      return 'skipped';
    }

    if (!(await openCreateWallet())) {
      err('"Create a new wallet" button not found. Is the wallet screen open?');
      return 'failed';
    }

    if (!(await handleSeedStage(wallet))) {
      err('Could not get past the seed-phrase step.');
      return 'failed';
    }

    if (!(await handleNameStage(wallet))) {
      err('Could not fill the wallet name / press Next.');
      return 'failed';
    }

    if (!(await waitWalletCreated(wallet))) {
      err('Wallet was submitted but no success state appeared within the timeout.');
      return 'failed';
    }

    log('Created "' + wallet.name + '".');
    return 'created';
  }

  /* ---------------------------------------------------------------------- */
  /* 6. START-UP QUESTIONS + MAIN LOOP                                      */
  /* ---------------------------------------------------------------------- */

  function askBaseName() {
    const configured = norm(cfg.baseName);
    if (configured) return configured;

    const answer = window.prompt('Wallet base name?\n\nExample: XT  ->  XT01, XT02, ... XT' + cfg.total, 'XT');
    if (answer === null) return null;
    return norm(answer);
  }

  function askSeedMode() {
    const mode = lower(cfg.seedMode);
    const preset = normalizeSeed(cfg.seedPhrase);

    if (mode === 'new') return { mode: 'new', phrase: '' };

    if (preset) {
      if (wordCount(preset) < 12) return { error: 'seedPhrase in the config has fewer than 12 words.' };
      return { mode: 'existing', phrase: preset };
    }

    const answer = window.prompt(
      'Seed phrase for wallet 1:\n\n' +
      '• Type "NEW"  ->  the app generates a fresh seed phrase, this script copies it\n' +
      '  from the screen and reuses it for wallets 2..' + cfg.total + '\n' +
      '• Or paste your own 12 / 24-word seed phrase  ->  every wallet imports that phrase\n\n' +
      'The value stays in this tab\'s memory only (gone after a reload).',
      'NEW'
    );
    if (answer === null) return { cancelled: true };
    const cleaned = normalizeSeed(answer);
    if (!cleaned) return { cancelled: true };
    if (/^new$/.test(cleaned)) return { mode: 'new', phrase: '' };
    if (wordCount(cleaned) < 12) {
      return { error: 'Seed phrase looks invalid (' + wordCount(cleaned) + ' words). Need 12 / 15 / 18 / 21 / 24.' };
    }
    return { mode: 'existing', phrase: cleaned };
  }

  async function ensurePhraseForImport(wallet) {
    if (wallet.phrase) return true;
    const answer = window.prompt(
      'The seed phrase could not be captured from the screen.\n\n' +
      'Paste the 12 / 24-word seed phrase to import for wallets 2..' + cfg.total + ':',
      ''
    );
    if (answer === null) return false;
    const cleaned = normalizeSeed(answer);
    if (wordCount(cleaned) < 12) {
      err('Seed phrase invalid (' + wordCount(cleaned) + ' words).');
      return false;
    }
    wallet.phrase = cleaned;
    state.capturedSeed = cleaned;
    return true;
  }

  async function main() {
    state.running = true;
    window.__jupWalletsRunning = true;
    const startedAt = now();

    try {
      if (cfg.total < cfg.startIndex) {
        err('Nothing to do: total (' + cfg.total + ') is smaller than startIndex (' + cfg.startIndex + ').');
        return;
      }

      const baseName = askBaseName();
      if (baseName === null) { log('Cancelled.'); return; }

      const seedAnswer = askSeedMode();
      if (seedAnswer.cancelled) { log('Cancelled.'); return; }
      if (seedAnswer.error) { err(seedAnswer.error); return; }

      const plan = {
        baseName,
        mode: seedAnswer.mode,   // 'new'  -> wallet 1 generates, 2.. import it
        phrase: seedAnswer.phrase || '', // 'existing' -> import this every time
      };

      log('Starting ' + (cfg.total - cfg.startIndex + 1) + ' wallets: ' +
        plan.baseName + String(cfg.startIndex).padStart(cfg.pad, '0') + ' … ' +
        plan.baseName + String(cfg.total).padStart(cfg.pad, '0'));
      log('Seed mode: ' + (plan.mode === 'new'
        ? (cfg.newSeedEachWallet ? 'fresh seed phrase generated for every wallet' : 'generate once, reuse for the rest')
        : 'import one phrase for every wallet'));

      for (let i = cfg.startIndex; i <= cfg.total; i += 1) {
        if (state.stopRequested) { log('Stop requested — halting at index ' + i + '.'); break; }

        // "NEW" + newSeedEachWallet -> every wallet gets its own freshly generated phrase
        const ownSeedEach = plan.mode === 'new' && !!cfg.newSeedEachWallet;
        const useNewSeed = plan.mode === 'new' && (ownSeedEach || i === cfg.startIndex);
        const wallet = {
          index: i,
          name: plan.baseName + String(i).padStart(cfg.pad, '0'),
          mode: useNewSeed ? 'new' : 'existing',
          phrase: useNewSeed ? '' : plan.phrase,
          seedTypeChosen: false,
          seedFilled: false,
          seedRevealed: false,
          usedNewSeedScreen: false,
        };

        if (wallet.mode === 'existing' && !wallet.phrase) {
          const ok = await ensurePhraseForImport(wallet);
          if (!ok) { err('No seed phrase available — stopping.'); break; }
          plan.phrase = wallet.phrase;
        }

        let result = 'failed';
        try {
          result = await runWallet(i, wallet);
        } catch (e) {
          err('Unexpected error on ' + wallet.name + ': ' + (e && e.message ? e.message : e));
        }

        if (result === 'created') state.created.push(wallet.name);
        else if (result === 'skipped') state.skipped.push(wallet.name);
        else state.failed.push(wallet.name);

        // wallet 1 generated the seed -> reuse it for every later wallet
        // (never do this when every wallet is meant to have its own seed)
        if (wallet.mode === 'new' && wallet.phrase && !plan.phrase && !cfg.newSeedEachWallet) {
          plan.phrase = wallet.phrase;
          log('Wallets 2..' + cfg.total + ' will import this same seed phrase.');
        }

        if (result === 'failed' && cfg.stopOnError) {
          warn('Stopping because stopOnError = true. Fix the page state, then resume with:');
          warn('  window.JUP_WALLETS_CONFIG = { startIndex: ' + (i + 1) + ', baseName: "' + plan.baseName + '" };');
          break;
        }

        await sleep(cfg.afterCreateDelayMs);
      }
    } finally {
      state.running = false;
      window.__jupWalletsRunning = false;

      const seconds = Math.round((now() - startedAt) / 1000);
      log('---------------- SUMMARY (' + seconds + 's) ----------------');
      log('Created: ' + state.created.length + (state.created.length ? '  -> ' + state.created.join(', ') : ''));
      log('Skipped: ' + state.skipped.length + (state.skipped.length ? '  -> ' + state.skipped.join(', ') : ''));
      log('Failed:  ' + state.failed.length + (state.failed.length ? '  -> ' + state.failed.join(', ') : ''));
      if (state.capturedSeed) {
        log('Seed phrase used: ' + maskSeed(state.capturedSeed));
        log('Back it up from the wallet UI now — it is only kept in this tab\'s memory.');
      }
      log('-----------------------------------------------------------');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 7. PUBLIC HANDLE                                                       */
  /* ---------------------------------------------------------------------- */

  window.jupiterWallets = {
    stop() {
      state.stopRequested = true;
      log('Stop requested — will stop after the current wallet finishes.');
    },
    status() {
      return {
        running: state.running,
        created: state.created.slice(),
        skipped: state.skipped.slice(),
        failed: state.failed.slice(),
      };
    },
    /** Returns the seed phrase the run captured (keep this private!). */
    getSeed: () => state.capturedSeed,
    config: cfg,
    labels,
  };

  main().catch((e) => {
    state.running = false;
    window.__jupWalletsRunning = false;
    err('Fatal error: ' + (e && e.stack ? e.stack : e));
  });
})();
