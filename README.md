# Jupiter Wallet Automation

Automated account creator for the Jupiter (Solana DEX) wallet extension. Creates multiple wallet accounts and **saves all credentials** (seed phrases, wallet names, addresses) to downloadable files.

## Features

- ✅ **Create any number of accounts** — user specifies how many (1, 5, 50, 100…)
- ✅ **Auto-captures seed phrases** from the Jupiter UI
- ✅ **Auto-captures wallet addresses** after creation
- ✅ **Saves credentials to JSON + CSV files** — auto-downloads when done
- ✅ **Console summary table** — see all accounts at a glance
- ✅ **Resume-friendly** — credentials stored in `window.jupiterWalletCredentials`
- ✅ **Error handling** — skips failed wallets and continues

## Usage

1. Open [Jupiter](https://jup.ag) in Chrome/Edge
2. Go to the wallet screen where **"Create a new wallet"** is visible
3. Open DevTools (`F12`) → **Console** tab
4. Type `allow pasting` if prompted, then press Enter
5. Paste the contents of `automateJupiterWallets.js` and press Enter
6. Answer the prompts:
   - **Base name** — e.g. `XT` → creates `XT01`, `XT02`, etc.
   - **How many accounts** — e.g. `5`
7. Watch it work! At the end:
   - A **summary table** appears in the console
   - **Two files auto-download**: `jupiter-wallets-<date>.json` and `.csv`

## Output Files

### JSON (`jupiter-wallets-2026-11-09T12-30-00.json`)
```json
{
  "exportDate": "2026-11-09T12:30:00.000Z",
  "totalAccounts": 5,
  "accounts": [
    {
      "index": 1,
      "walletName": "XT01",
      "seedPhrase": "word1 word2 word3 ... word12",
      "walletAddress": "7xKX...3nPq",
      "createdAt": "2026-11-09T12:30:05.000Z",
      "status": "success"
    }
  ]
}
```

### CSV (`jupiter-wallets-2026-11-09T12-30-00.csv`)
```
Index,Wallet Name,Seed Phrase,Wallet Address,Created At
1,"XT01","word1 word2 ... word12","7xKX...3nPq","2026-11-09T12:30:05.000Z"
```

## After the Run

- Access credentials in console: `window.jupiterWalletCredentials`
- Re-download files: `window.saveJupiterCredentials()`

## ⚠️ Security Warning

- The downloaded files contain **seed phrases (private keys)**
- Move them to a secure location immediately (password manager, encrypted drive)
- **Never share** these files — anyone with the seed phrase controls the wallets
- Delete from Downloads folder after securing
- Do not screen-share or record while the script is running

## File Structure

| File | Description |
|---|---|
| `automateJupiterWallets.js` | Main automation script (paste into DevTools) |
| `jupiter-wallets.console.js` | Hardened v2 with advanced config (optional) |
| `run-wallet-creation.js` | Node.js launcher for VS Code (optional) |
| `test/` | Automated browser tests |
