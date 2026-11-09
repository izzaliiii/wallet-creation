/* ============================================================================
 * Jupiter Wallet — Automated Account Creator & Credential Saver
 * ============================================================================
 * BROWSER-ONLY — paste into Chrome DevTools Console on the Jupiter wallet page.
 *
 * WHAT IT DOES:
 *   1. Asks how many accounts to create
 *   2. Creates each wallet account on the Jupiter extension
 *   3. Captures seed phrase, wallet name, wallet address for EVERY account
 *   4. Saves ALL credentials to a downloadable JSON + CSV file
 *   5. Also displays everything in the console
 *
 * SECURITY WARNING:
 *   Seed phrases give full control of wallets. The downloaded file contains
 *   PRIVATE KEYS. Store it securely, never share it, and delete it from
 *   Downloads after moving to a safe location (password manager, encrypted
 *   drive, etc.)
 * ========================================================================== */

if (typeof window === 'undefined' || typeof document === 'undefined') {
  console.error([
    '',
    '  This is BROWSER code — paste it into Chrome DevTools Console,',
    '  not into Node.js or VS Code terminal.',
    '',
    '  Steps:',
    '    1. Open Jupiter wallet page in Chrome/Edge',
    '    2. Press F12 → Console tab',
    '    3. Type "allow pasting" if prompted',
    '    4. Paste this script and press Enter',
    '',
  ].join('\n'));
  if (typeof process !== 'undefined') process.exit(0);
}

async function automateJupiterWallets() {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // ═══════════════════════════════════════════════════════════════════════════
  // CREDENTIAL STORAGE — all account info collected here
  // ═══════════════════════════════════════════════════════════════════════════
  const credentials = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Find visible element by text (searches buttons, divs, spans, headings)
  function findElementByText(text) {
    const selectors = 'button, [role="button"], div, span, p, h1, h2, h3, label, a';
    const elements = Array.from(document.querySelectorAll(selectors));

    // Prefer exact matches first, then partial matches
    const exact = elements.find(el => {
      const label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const visible = el.getClientRects().length > 0;
      return visible && label.toLowerCase() === text.toLowerCase();
    });
    if (exact) return exact;

    return elements.find(el => {
      const label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const visible = el.getClientRects().length > 0;
      return visible && label.toLowerCase().includes(text.toLowerCase());
    }) || null;
  }

  // Wait for element to appear (polls every 300ms)
  async function waitElement(text, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = findElementByText(text);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  // React-compatible input setter
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Try to capture the seed phrase from the screen
  function captureSeedPhrase() {
    // Look for seed phrase words in common containers
    const seedContainers = document.querySelectorAll(
      '[class*="seed"], [class*="mnemonic"], [class*="phrase"], [class*="recovery"], [data-testid*="seed"]'
    );

    for (const container of seedContainers) {
      const text = (container.innerText || container.textContent || '').trim();
      const words = text.split(/\s+/).filter(w => /^[a-z]+$/.test(w));
      if (words.length === 12 || words.length === 24) {
        return words.join(' ');
      }
    }

    // Fallback: look for numbered word elements (1. word, 2. word, etc.)
    const allText = document.body.innerText || '';
    const wordPattern = /(?:\d+\.\s*)([a-z]+)/g;
    const matches = [];
    let m;
    while ((m = wordPattern.exec(allText)) !== null) {
      matches.push(m[1]);
    }
    if (matches.length === 12 || matches.length === 24) {
      return matches.join(' ');
    }

    // Try to find any grid/list of 12 or 24 single words
    const wordElements = document.querySelectorAll('span, div, p, td');
    const singleWords = [];
    for (const el of wordElements) {
      const t = (el.innerText || '').trim();
      if (/^[a-z]{2,10}$/.test(t) && el.children.length === 0) {
        singleWords.push(t);
      }
    }
    if (singleWords.length >= 12) {
      const phrase = singleWords.slice(0, singleWords.length >= 24 ? 24 : 12);
      return phrase.join(' ');
    }

    return null;
  }

  // Try to capture the wallet address from the screen
  function captureWalletAddress() {
    // Solana addresses are Base58, 32-44 chars
    const allText = document.body.innerText || '';
    const solanaAddrPattern = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
    const addresses = [];
    let m;
    while ((m = solanaAddrPattern.exec(allText)) !== null) {
      // Filter out common false positives
      if (m[1].length >= 32 && m[1].length <= 44) {
        addresses.push(m[1]);
      }
    }
    // Return the last found address (most likely the newly created one)
    return addresses.length > 0 ? addresses[addresses.length - 1] : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE DOWNLOAD HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function downloadFile(content, filename, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`📥 Downloaded: ${filename}`);
  }

  function saveCredentials() {
    if (credentials.length === 0) {
      console.warn('No credentials to save.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Save as JSON
    const jsonData = JSON.stringify({
      exportDate: new Date().toISOString(),
      totalAccounts: credentials.length,
      accounts: credentials,
    }, null, 2);
    downloadFile(jsonData, `jupiter-wallets-${timestamp}.json`);

    // Save as CSV
    const csvHeader = 'Index,Wallet Name,Seed Phrase,Wallet Address,Created At\n';
    const csvRows = credentials.map(c =>
      `${c.index},"${c.walletName}","${c.seedPhrase || 'N/A'}","${c.walletAddress || 'N/A'}","${c.createdAt}"`
    ).join('\n');
    downloadFile(csvHeader + csvRows, `jupiter-wallets-${timestamp}.csv`, 'text/csv');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER INPUT
  // ═══════════════════════════════════════════════════════════════════════════

  const baseName = prompt('Enter wallet base name (e.g. XT):', 'XT');
  if (!baseName) {
    console.log('❌ Process cancelled.');
    return;
  }

  const totalInput = prompt('How many accounts to create?', '5');
  const total = parseInt(totalInput, 10);
  if (!total || total < 1) {
    console.log('❌ Invalid number. Process cancelled.');
    return;
  }

  const padSize = String(total).length < 2 ? 2 : String(total).length;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Creating ${total} wallet(s): ${baseName}${'0'.repeat(padSize - 1)}1 → ${baseName}${String(total).padStart(padSize, '0')}`.padEnd(57) + '║');
  console.log('║  Credentials will be saved to JSON + CSV when done.     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN LOOP — Create each wallet
  // ═══════════════════════════════════════════════════════════════════════════

  let seedPhraseToReuse = null;

  for (let i = 1; i <= total; i++) {
    const walletName = baseName + String(i).padStart(padSize, '0');
    const accountData = {
      index: i,
      walletName: walletName,
      seedPhrase: null,
      walletAddress: null,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    console.log(`\n━━━ Account ${i}/${total}: ${walletName} ━━━`);

    try {
      // Step 1: Click "Create a new wallet"
      console.log('  [1/5] Looking for "Create a new wallet"...');
      const addButton = await waitElement('Create a new wallet', 12000);
      if (!addButton) {
        console.error('  ❌ "Create a new wallet" button not found!');
        accountData.status = 'failed - create button not found';
        credentials.push(accountData);
        continue;
      }
      addButton.click();
      await sleep(1500);

      // Step 2: Seed Phrase handling
      if (i === 1) {
        // First wallet — generate new seed phrase
        console.log('  [2/5] Selecting "New Seed Phrase"...');
        const newSeed = await waitElement('New Seed Phrase', 10000);
        if (!newSeed) {
          console.error('  ❌ "New Seed Phrase" option not found!');
          accountData.status = 'failed - new seed option not found';
          credentials.push(accountData);
          continue;
        }
        newSeed.click();
        await sleep(1500);

        // Reveal the seed phrase
        console.log('  [2/5] Revealing seed phrase...');
        const revealBtn = await waitElement('Reveal Seed Phrase', 8000);
        if (revealBtn) {
          revealBtn.click();
          await sleep(2500);

          // ★ CAPTURE the seed phrase
          const captured = captureSeedPhrase();
          if (captured) {
            seedPhraseToReuse = captured;
            accountData.seedPhrase = captured;
            console.log(`  ✅ Seed phrase captured! (${captured.split(' ').length} words)`);
          } else {
            console.warn('  ⚠️ Could not auto-capture seed phrase. Please note it manually!');
            const manualSeed = prompt('Paste the seed phrase here (or press Cancel to skip):');
            if (manualSeed && manualSeed.trim().split(/\s+/).length >= 12) {
              seedPhraseToReuse = manualSeed.trim();
              accountData.seedPhrase = manualSeed.trim();
            }
          }
        }

        // Handle checkbox ("I have saved my seed phrase")
        const checkbox = document.querySelector('input[type="checkbox"]:not(:checked)');
        if (checkbox) {
          checkbox.click();
          await sleep(500);
        }

        // Click Continue
        console.log('  [2/5] Clicking Continue...');
        const continueBtn = await waitElement('Continue', 8000)
                         || await waitElement('Next', 5000)
                         || await waitElement('Confirm', 5000);
        if (continueBtn) {
          continueBtn.click();
          await sleep(1500);
        }

      } else {
        // Wallets 2+ — use existing seed phrase
        console.log('  [2/5] Selecting "Existing Seed Phrase"...');
        const existingSeed = await waitElement('Existing Seed Phrase', 10000);
        if (!existingSeed) {
          console.error('  ❌ "Existing Seed Phrase" option not found!');
          accountData.status = 'failed - existing seed option not found';
          credentials.push(accountData);
          continue;
        }
        existingSeed.click();
        await sleep(1500);

        // Fill in the seed phrase
        if (seedPhraseToReuse) {
          accountData.seedPhrase = seedPhraseToReuse;

          // Find seed phrase input (textarea or input field)
          const seedInput = document.querySelector('textarea') 
                         || document.querySelector('input[placeholder*="seed"]')
                         || document.querySelector('input[placeholder*="phrase"]')
                         || document.querySelector('input[placeholder*="recovery"]')
                         || document.querySelector('input[type="text"]');

          if (seedInput) {
            seedInput.focus();
            if (seedInput.tagName === 'TEXTAREA') {
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
              setter.call(seedInput, seedPhraseToReuse);
            } else {
              setInputValue(seedInput, seedPhraseToReuse);
            }
            seedInput.dispatchEvent(new Event('input', { bubbles: true }));
            seedInput.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(1000);
            console.log('  ✅ Seed phrase entered');
          }

          // Click Import / Continue
          const importBtn = await waitElement('Import', 5000)
                         || await waitElement('Continue', 5000)
                         || await waitElement('Next', 5000)
                         || await waitElement('Restore', 5000);
          if (importBtn) {
            importBtn.click();
            await sleep(1500);
          }
        }
      }

      // Step 3: Enter Wallet Name
      console.log(`  [3/5] Entering wallet name: ${walletName}...`);
      let nameInput = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        nameInput = document.querySelector('input[name="wallet-name-input"]')
                 || document.querySelector('input[placeholder*="Trading"]')
                 || document.querySelector('input[placeholder*="name"]')
                 || document.querySelector('input[placeholder*="wallet"]')
                 || document.querySelector('input[type="text"]');
        if (nameInput) break;
        await sleep(500);
      }

      if (nameInput) {
        nameInput.focus();
        setInputValue(nameInput, walletName);
        await sleep(1000);
        console.log(`  ✅ Name set: ${walletName}`);
      } else {
        console.error('  ❌ Name input field not found!');
        accountData.status = 'failed - name input not found';
        credentials.push(accountData);
        continue;
      }

      // Step 4: Click Next / Confirm / Create
      console.log('  [4/5] Confirming wallet creation...');
      const confirmBtn = await waitElement('Next', 5000)
                      || await waitElement('Confirm', 5000)
                      || await waitElement('Create', 5000)
                      || await waitElement('Create Wallet', 5000)
                      || await waitElement('Done', 5000);

      if (confirmBtn) {
        confirmBtn.click();
        await sleep(2500);
      } else {
        console.error('  ❌ Confirm/Next button not found!');
        accountData.status = 'failed - confirm button not found';
        credentials.push(accountData);
        continue;
      }

      // Step 5: Capture wallet address
      console.log('  [5/5] Capturing wallet address...');
      await sleep(2000);
      const address = captureWalletAddress();
      if (address) {
        accountData.walletAddress = address;
        console.log(`  ✅ Address: ${address.slice(0, 6)}...${address.slice(-4)}`);
      } else {
        console.warn('  ⚠️ Could not auto-capture wallet address');
      }

      accountData.status = 'success';
      credentials.push(accountData);

      console.log(`  ✅ Account ${walletName} created successfully!`);

      // Delay before next wallet
      if (i < total) {
        console.log(`  ⏳ Waiting before next account...`);
        await sleep(3000);
      }

    } catch (err) {
      console.error(`  ❌ Error creating ${walletName}:`, err.message);
      accountData.status = `failed - ${err.message}`;
      credentials.push(accountData);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY & SAVE
  // ═══════════════════════════════════════════════════════════════════════════

  const successful = credentials.filter(c => c.status === 'success').length;
  const failed = credentials.filter(c => c.status !== 'success').length;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                   PROCESS COMPLETE                      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Successful: ${String(successful).padEnd(39)}║`);
  console.log(`║  ❌ Failed:     ${String(failed).padEnd(39)}║`);
  console.log(`║  📊 Total:      ${String(credentials.length).padEnd(39)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Display all accounts in console
  console.log('\n📋 Account Details:\n');
  console.table(credentials.map(c => ({
    '#': c.index,
    'Name': c.walletName,
    'Address': c.walletAddress ? `${c.walletAddress.slice(0, 8)}...${c.walletAddress.slice(-6)}` : 'N/A',
    'Seed Words': c.seedPhrase ? c.seedPhrase.split(' ').length + ' words' : 'N/A',
    'Status': c.status,
  })));

  // Auto-save files
  console.log('\n💾 Saving credentials...');
  saveCredentials();

  // Also store in window for manual access
  window.jupiterWalletCredentials = credentials;
  console.log('\n💡 Credentials also available at: window.jupiterWalletCredentials');
  console.log('💡 To re-download: paste this → saveCredentials()');

  // Make saveCredentials available globally for re-download
  window.saveJupiterCredentials = saveCredentials;
}

automateJupiterWallets();
