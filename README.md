# Jupiter Wallet Automation

Browser-console automation for bulk-creating wallets in the Jupiter (Solana DEX) web UI.

This repo contains **two** versions of the script — the original one, and a hardened
rewrite that is slower to break and has a real headless-browser test.

| File | What it is |
|---|---|
| [`jupiter-wallets.console.js`](jupiter-wallets.console.js) | **Recommended.** Hardened script: modal-aware clicking, React-safe inputs, seed capture/reuse, per-wallet unique seeds, resume/stop, retries. |
| [`automateJupiterWallets.js`](automateJupiterWallets.js) | The original v1 script, kept for reference. |
| [`.vscode/tasks.json`](.vscode/tasks.json) | `Ctrl+Shift+B` → copy script to clipboard / run the test. |
| [`test/mock-wallet.html`](test/mock-wallet.html) | Fake Jupiter flow used by the automated test. |
| [`test/run-test.mjs`](test/run-test.mjs) | Runs the real script against the mock page in headless Chrome. |
| [`package.json`](package.json) | `npm test` shortcut for the test. |

> **The scripts are browser code** (`document`, `prompt()`, `HTMLInputElement`). They
> cannot run in a Node/VS Code terminal — they run inside Chrome's DevTools Console on
> the wallet tab. VS Code is the editor / launcher here.
>
> **Do not click VS Code's ▷ Run button on these files.** That executes them with Node,
> which has no `window`/`document`/`prompt`, so you get
> `ReferenceError: prompt is not defined` (or `document is not defined`). Both files now
> print a how-to message instead of crashing when that happens — then run them in the
> browser as described below.

---

## Hardened version (`jupiter-wallets.console.js`)

### Quick start

1. Open the Jupiter wallet page in Chrome/Edge, log in, and stay on the screen where
   **“Create a new wallet”** is visible.
2. Open DevTools (`F12`) → **Console** tab.
3. First time only: if you see *“Warning: Don't paste code into the DevTools Console…”*,
   type `allow pasting` and press Enter.
4. In VS Code run the task **`Jupiter: copy console script to clipboard`**
   (`Ctrl+Shift+B`), click into the DevTools Console, press `Ctrl+V`, then Enter.

### Better: DevTools Snippets (persistent, no re-pasting)

1. DevTools → **Sources** → **Snippets** → **+ New snippet** → name it `jupiter-wallets`.
2. Paste `jupiter-wallets.console.js` into it, press `Ctrl+S`.
3. Run with `Ctrl+Enter` whenever the wallet tab is ready.

### First run: always test with 2 wallets

```js
window.JUP_WALLETS_CONFIG = { total: 2, baseName: 'TEST' };
```

Run the script, check the two wallets, then reset for the real run:

```js
window.JUP_WALLETS_CONFIG = { total: 100, baseName: 'XT' };
```

Config must be set on the page **before** the script starts and is lost on reload.
Without it, the script asks for a base name and seed mode with `prompt()`.

### Seed phrase behaviour

| Answer at the seed prompt | Wallet 1 | Wallets 2…N | Notes |
|---|---|---|---|
| `NEW` (default) | generates a new phrase, script captures it from the screen | import that **same** phrase | fastest, one backup to keep |
| paste a 12/24-word phrase | imports it | imports it | every wallet uses your phrase |
| `NEW` + `newSeedEachWallet: true` | own new phrase | own new phrase (captured each time) | **use if reused seeds produce duplicate addresses** |

⚠️ **Reusing one seed means reusing the same keys.** If the app derives the same first
account from the same phrase, wallets 2…N can end up with the **same address** as
wallet 1. Run the 2-wallet test first, compare addresses, and if they match rerun with:

```js
window.JUP_WALLETS_CONFIG = {
  total: 100, baseName: 'XT', seedMode: 'new', newSeedEachWallet: true,
};
```

In that mode every wallet has its own phrase, so back each one up from the wallet UI —
the script only logs a masked fingerprint (first word … last word).

The phrase is kept in the tab's memory only. It is **never** written to storage, files
or the network. Reloading the page wipes it.

### Config reference

```js
window.JUP_WALLETS_CONFIG = { /* all keys optional */ };
```

| Key | Default | Meaning |
|---|---|---|
| `baseName` | `''` → prompt (`XT`) | Names are `baseName + padded index`: `XT01 … XT100` |
| `total` | `100` | How many wallets to create |
| `startIndex` | `1` | Resume point after a break (e.g. `47`) |
| `pad` | `2` | `XT01` vs `XT001` |
| `seedMode` | `''` → prompt | `'new'` = generate & reuse, `'existing'` = import `seedPhrase` |
| `seedPhrase` | `''` | Phrase to import (skips the seed prompt) |
| `newSeedEachWallet` | `false` | Each wallet gets a freshly generated phrase |
| `stepDelayMs` | `1200` | Pause after each UI action (raise if the app is slow) |
| `actionTimeoutMs` | `12000` | How long to wait for a button / field |
| `afterCreateDelayMs` | `2500` | Pause between wallets |
| `stopOnError` | `true` | `false` = skip a broken wallet and continue |
| `skipExistingNames` | `true` | Skip names already visible in the wallet list |
| `nameSelector` | `''` | CSS selector for the wallet-name input, if auto-detection fails |
| `seedSelector` | `''` | CSS selector for the seed-phrase textarea, if auto-detection fails |
| `labels` | see source | Override button texts when the UI wording changes |

```js
// slow machine, no prompts, unique seed per wallet
window.JUP_WALLETS_CONFIG = {
  baseName: 'XT', total: 100, seedMode: 'new', newSeedEachWallet: true,
  stepDelayMs: 1800, actionTimeoutMs: 20000,
};

// resume from wallet 47 (in "new" mode supply the phrase again)
window.JUP_WALLETS_CONFIG = {
  baseName: 'XT', total: 100, startIndex: 47, seedPhrase: 'word1 word2 … word12',
};

// the UI wording changed
window.JUP_WALLETS_CONFIG = {
  labels: {
    createWallet: ['Add wallet'],
    newSeed: ['Create a fresh phrase'],
    nameAction: ['Save wallet', 'Next'],
  },
};
```

### Stop / resume

```js
window.jupiterWallets.stop();   // finishes the current wallet, then stops
window.jupiterWallets.status(); // created / skipped / failed so far
```

Or just reload the tab (the run dies immediately; nothing is saved). Resume with
`startIndex`; `skipExistingNames: true` also skips names already visible in the list.

### How it works

1. **Text matching.** Walks buttons, labels, headings and leaf `<div>`/`<span>`s,
   prefers exact matches, then real buttons, then the shortest label (clicks the inner
   button, not a wrapping `<div>`), and also reads `aria-label`, `title` and
   `<input type="submit" value>` for icon-only buttons.
2. **React inputs.** Sets values through the native `HTMLInputElement` value setter plus
   bubbling `input`/`change` events (the standard React trick), verifies the value, and
   falls back to `document.execCommand('insertText')` if the framework swallowed it.
3. **Screen awareness.** Each wallet is a small state machine: create button → seed-type
   screen → seed entry *or* reveal screen → name field → Next/Confirm → wait for the
   wallet to appear. Searches are scoped to the open modal, so a dashboard search box or
   a background button can't hijack a click, and already-ticked checkboxes are never
   re-clicked (otherwise a `Continue` button can flap forever).

If a step fails the script stops and says which step. Typical fixes: wording changed →
override that entry in `labels`; field not detected → set `nameSelector` / `seedSelector`;
slow app → raise the delays.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `prompt is not defined` / `document is not defined` | You clicked Run in VS Code (Node). These files only run in the browser DevTools Console — see Quick start. |
| Nothing happens after Enter | Paste was blocked by DevTools; type `allow pasting` and retry, or use Snippets. |
| `"Create a new wallet" button not found` | Wrong page, logged out, or a modal is open. Go back to the wallet list and rerun `startIndex`. |
| Prompt never shows | Set `baseName` and `seedMode` (and `seedPhrase`) in the config instead. |
| Name typed but Next stays disabled | Raise `actionTimeoutMs`, or set `nameSelector`. |
| Seed phrase “could not be captured” | Use `seedMode: 'existing'` + `seedPhrase`, or `newSeedEachWallet: true` and paste the phrase when asked. |
| Wallet created but script reports failure | Slow page — raise `actionTimeoutMs`; check `status()`. |
| Duplicate wallet addresses | Reused seed — rerun with `newSeedEachWallet: true`. |
| Rate limiting / network errors | Raise `afterCreateDelayMs` (e.g. 5000) and run in smaller batches. |

### Automated browser test

```powershell
npm test          # or: node test/run-test.mjs
```

`test/run-test.mjs` drives the **real script** against `test/mock-wallet.html` in
headless Chrome and covers three scenarios: *generate-once-and-reuse*,
*import-one-phrase*, and *new-seed-per-wallet*. It also asserts the decoy button is
never clicked and the dashboard search box is never typed into. Needs Chrome or Edge
(set `CHROME_PATH` if installed elsewhere).

Status: **all 3 scenarios pass** (Chrome 156, headless).

---

## Original script (`automateJupiterWallets.js`)

The first version, kept functionally unchanged for reference. Only a browser-only guard
was added, so a mistaken Node/VS-Code run prints instructions instead of
`ReferenceError: prompt is not defined`.

### What it does

- Prompts for a base wallet name (e.g., `XT`)
- Creates 100 wallets named `XT01` through `XT100`
- First wallet: generates a **new seed phrase**
- Wallets 2–100: reuses the **existing seed phrase** (derived wallets)

### Usage

1. Open [Jupiter](https://jup.ag) in your browser
2. Open the browser Developer Console (`F12` → Console tab)
3. Paste the contents of `automateJupiterWallets.js` into the console
4. Enter your desired base wallet name when prompted
5. Let the script run — it will log progress to the console

### Known limitations (fixed in the hardened version)

- `findElementByText()` returns the first visible element whose text *contains* the
  label, often an outer `<div>` — the click can land on nothing.
- No waiting for the name field to appear reliably; no verification that the value stuck.
- No seed-phrase handling for wallets 2–100, no success check, no resume, no retry.

---

## ⚠️ Important

- **Back up your seed phrase** during the first wallet creation — the script does not
  save it, and in `newSeedEachWallet` mode each wallet has its own phrase.
- A seed phrase controls the wallets. Do not screen-share, record, or paste console logs
  while a run is in progress, and close DevTools when done. Any malicious extension with
  page access could read it — use a clean browser profile.
- Make sure you are on the genuine Jupiter wallet domain (check the address bar).
- Creating wallets in bulk may violate Jupiter's terms and any airdrop/anti-sybil rules.
  That risk is yours; this tool only automates clicks you asked for.
