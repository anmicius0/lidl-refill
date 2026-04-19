import { chromium } from "playwright";

// --- Configuration & Selectors ---
const CONFIG = {
  LOGIN_URL: "https://kundenkonto.lidl-connect.de/mein-lidl-connect.html",
  SELECTORS: {
    USER: "input[data-msisdn]",
    PASS: "input[data-password]",
    SUBMIT: 'form button[type="submit"]',
    REFILL_BTN: "button:has-text('Refill aktivieren')",
  },
  TIMEOUTS: {
    LOAD: 60000,
    NAV: 45000,
    ELEMENT: 20000,
  },
};

// --- Utilities ---
const timestamp = () => new Date().toISOString();
const log = (msg) => console.log(`[${timestamp()}] ${msg}`);
const logErr = (msg) => console.error(`[${timestamp()}] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Random delay between min and max (in milliseconds)
const randomDelay = async (min = 1000, max = 3000, msg = "") => {
  const delay = Math.floor(Math.random() * (max - min)) + min;
  if (msg) log(`⏳ ${msg} (${delay}ms)...`);
  await sleep(delay);
};

// --- Setup & Validation ---
log("--- 🛠️ Environment Setup ---");
if (!process.env.LIDL_ACCOUNTS) {
  logErr("❌ Error: LIDL_ACCOUNTS environment variable is missing.");
  process.exit(1);
}

let accounts = [];
try {
  const cleanedAccounts = process.env.LIDL_ACCOUNTS.trim().replace(
    /^['"]|['"]$/g,
    "",
  );
  accounts = JSON.parse(cleanedAccounts);
  log(`👥 Loaded ${accounts.length} account(s).`);
} catch (e) {
  logErr("❌ Error: LIDL_ACCOUNTS is not valid JSON.");
  process.exit(1);
}

// --- Core Logic ---
async function performLogin(page, account, id) {
  log(`🔍 [${id}] Waiting for login form...`);

  await page
    .locator(CONFIG.SELECTORS.USER)
    .waitFor({ state: "visible", timeout: CONFIG.TIMEOUTS.ELEMENT });

  log(`✍️  [${id}] Entering credentials...`);
  await page
    .locator(CONFIG.SELECTORS.USER)
    .pressSequentially(account.user, { delay: 60 });
  await randomDelay(800, 1500); // Human-like pause between inputs
  await page
    .locator(CONFIG.SELECTORS.PASS)
    .pressSequentially(account.pass, { delay: 60 });

  await randomDelay(500, 1200, "Hesitating before submit");

  log(`🖱️  [${id}] Submitting and waiting for redirect...`);
  await page.locator(CONFIG.SELECTORS.SUBMIT).click();

  await page.waitForURL(/\/uebersicht/, { timeout: CONFIG.TIMEOUTS.NAV });
  log(`✅ [${id}] Login Successful. Reached dashboard.`);
}

async function triggerRefill(page, id) {
  log(`🔍 [${id}] Searching for refill button...`);
  await randomDelay(1000, 2000);

  try {
    const refillBtn = page.locator(CONFIG.SELECTORS.REFILL_BTN);
    await refillBtn.waitFor({ state: "visible", timeout: 15000 });
    log(`✨ [${id}] Refill button found.`);

    // Setup API interceptor before clicking
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/graphql") && r.request().method() === "POST",
      { timeout: CONFIG.TIMEOUTS.ELEMENT },
    );

    await randomDelay(500, 1000);
    await refillBtn.click();
    log(`🖱️  [${id}] Clicked refill button. Waiting for API...`);

    const apiRes = await responsePromise;
    const body = await apiRes.text().catch(() => "");

    if (!apiRes.ok() || body.toLowerCase().includes("error")) {
      logErr(`❌ [${id}] API Error. Status: ${apiRes.status()}`);
    } else {
      log(`🎉 [${id}] Refill success! Status: ${apiRes.status()}`);
    }
  } catch (e) {
    log(`⚠️  [${id}] Refill button not found. May already be active.`);
  }
}

async function processAccount(browser, account) {
  if (!account.user || !account.pass) return;

  const id = `***${account.user.slice(-4)}`;
  log(`\n--- 👤 [Account: ${id}] Starting ---`);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "de-DE",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // Aggressive Resource Blocking for lower memory/CPU usage
  await page.route("**/*", (route) => {
    const blockedTypes = ["image", "font", "media", "stylesheet", "other"];
    blockedTypes.includes(route.request().resourceType())
      ? route.abort()
      : route.continue();
  });

  try {
    log(`📡 [${id}] Navigating to Login Page...`);
    const response = await page.goto(CONFIG.LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.TIMEOUTS.LOAD,
    });

    if (response && response.status() >= 400) {
      throw new Error(`Server error status: ${response.status()}`);
    }

    await randomDelay(1000, 2500, "Human pause after load");
    await performLogin(page, account, id);
    await triggerRefill(page, id);
  } catch (err) {
    logErr(`💥 [${id}] ERROR: ${err.message}`);
    if (err.message.includes("Timeout")) {
      logErr(`⏰ [${id}] Element did not appear in time (Timeout).`);
    }
    // Note: Error screenshots removed as requested.
  } finally {
    await context.close();
    log(`🧹 [${id}] Context closed.`);
  }
}

// --- Main Execution ---
(async () => {
  log(`🚀 Launching Browser`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  });

  try {
    // Process accounts SEQUENTIALLY to save RAM and CPU
    for (const account of accounts) {
      await processAccount(browser, account);
    }
    log(`\n🏁 All accounts processed successfully.`);
  } catch (err) {
    logErr(`❌ Global execution error: ${err.message}`);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
