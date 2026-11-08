async function automateJupiterWallets() {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Find clickable or target elements including h3, h2, divs, spans, buttons
  function findElementByText(text) {
    const elements = Array.from(
      document.querySelectorAll('button, [role="button"], div, span, p, h1, h2, h3')
    );

    return elements.find(el => {
      const label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const visible = el.getClientRects().length > 0;
      return visible && label.toLowerCase().includes(text.toLowerCase());
    }) || null;
  }

  // Wait for a visible element
  async function waitElement(text, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = findElementByText(text);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  // Helper to click the Back arrow (←) if needed
  async function clickBack() {
    const elements = Array.from(document.querySelectorAll('button, div, span'));
    const backBtn = elements.find(el => {
      const text = el.innerText || el.textContent || '';
      return text.includes('←') || el.querySelector('svg');
    });
    if (backBtn) {
      backBtn.click();
      await sleep(1000);
      console.log('Back button clicked!');
      return true;
    }
    return false;
  }

  // React-compatible input setter
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const baseName = prompt('Wallet base name enter karein:', 'XT');
  if (!baseName) {
    console.log('Process cancelled.');
    return;
  }

  const total = 100;
  console.log(`Starting full automated process for ${total} wallets (${baseName}01 to ${baseName}100)...`);

  for (let i = 1; i <= total; i++) {
    const walletName = baseName + String(i).padStart(2, '0');
    console.log(`\n--- Processing ${i}/${total}: ${walletName} ---`);

    // Step 1: Click "Create a new wallet"
    const addButton = await waitElement('Create a new wallet', 10000);
    if (!addButton) {
      console.error('"Create a new wallet" button nahi mila!');
      break;
    }
    addButton.click();
    await sleep(1500);

    // Step 2: Choose Seed Type
    if (i === 1) {
      console.log('Creating 1st wallet: New Seed Phrase...');
      const newSeed = await waitElement('New Seed Phrase');
      if (!newSeed) {
        console.error('New Seed Phrase option nahi mila!');
        break;
      }
      newSeed.click();
      await sleep(1500);

      // Reveal Seed Phrase button click handle
      const revealBtn = await waitElement('Reveal Seed Phrase', 5000);
      if (revealBtn) {
        revealBtn.click();
        console.log('Reveal Seed Phrase clicked!');
        await sleep(2000);
      } else {
        console.error('Reveal Seed Phrase button nahi mila!');
        break;
      }

      // Continue button click handle
      const continueBtn = await waitElement('Continue', 5000);
      if (continueBtn) {
        continueBtn.click();
        console.log('Continue clicked!');
        await sleep(1500);
      } else {
        console.error('Continue button nahi mila!');
        break;
      }
    } else {
      console.log(`Creating wallet ${i}: Existing Seed Phrase...`);
      const existingSeed = await waitElement('Existing Seed Phrase');
      if (!existingSeed) {
        console.error('Existing Seed Phrase option nahi mila!');
        break;
      }
      existingSeed.click();
      await sleep(1500);
    }

    // Step 3: Enter Wallet Name
    let nameInput = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      nameInput = document.querySelector('input[name="wallet-name-input"]') || 
                  document.querySelector('input[placeholder*="Trading"]') || 
                  document.querySelector('input[type="text"]');
      if (nameInput) break;
      await sleep(500);
    }

    if (nameInput) {
      nameInput.focus();
      setInputValue(nameInput, walletName);
      await sleep(1000);
      console.log(`Wallet name entered: ${walletName}`);
    } else {
      console.error('Name input field nahi mila!');
      break;
    }

    // Step 4: Click Next / Confirm / Create Button
    const nextBtn = await waitElement('Next', 5000) || 
                    await waitElement('Confirm', 5000) || 
                    await waitElement('Create', 5000);

    if (nextBtn) {
      nextBtn.click();
      console.log(`Wallet ${walletName} successfully created!`);
    } else {
      console.error('Next/Confirm button nahi mila!');
      break;
    }

    // Stabilize delay before starting next wallet
    await sleep(3000);
  }

  console.log('Process completed successfully!');
}

automateJupiterWallets();
