# Jupiter Wallet Automation

A browser console automation script to bulk-create wallets in the Jupiter (Solana DEX) web UI.

## What It Does

- Prompts for a base wallet name (e.g., `XT`)
- Creates 100 wallets named `XT01` through `XT100`
- First wallet: generates a **new seed phrase**
- Wallets 2–100: reuses the **existing seed phrase** (derived wallets)

## Usage

1. Open [Jupiter](https://jup.ag) in your browser
2. Open the browser Developer Console (`F12` → Console tab)
3. Paste the contents of `automateJupiterWallets.js` into the console
4. Enter your desired base wallet name when prompted
5. Let the script run — it will log progress to the console

## ⚠️ Important

- **Back up your seed phrase** during the first wallet creation — the script does not save it
- All 100 wallets share the same seed phrase — if it's compromised, all wallets are at risk
- The script relies on Jupiter's current UI text/labels and may break if the UI changes
