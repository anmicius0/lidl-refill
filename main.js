// /app/main.js
import { chromium } from "playwright-core";

const { LIDL_USERNAME, LIDL_PASSWORD } = process.env;

if (!LIDL_USERNAME || !LIDL_PASSWORD) {
  console.error("❌ Missing credentials.");
  process.exit(1);
}

await (async () => {
  // 1. Update Launch Config
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser", // Hardcoded for Docker
    args: ["--no-sandbox", "--disable-gpu", "--single-process"]
  });

  // Minimal Viewport (800x600) reduces rendering work
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });

  // Block resources at Context level (faster than Page level)
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    // Block stylesheets, fonts, images, media, AND other/eventsource to save bandwidth/CPU
    if (
      [
        "stylesheet",
        "image",
        "media",
        "font",
        "imageset",
        "texttrack",
        "object",
        "beacon",
        "csp_report",
      ].includes(type)
    ) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();

  // 2. Wrap your logic in a try/catch to signal job status
  try {
    console.log("⚡ Starting ultra-light auto-refill...");

    // Navigate
    await page.goto(
      "https://kundenkonto.lidl-connect.de/mein-lidl-connect.html",
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );

    // Login
    await page.fill("input[data-msisdn]", LIDL_USERNAME);
    await page.fill("input[data-password]", LIDL_PASSWORD);

    await Promise.all([
      // Wait for URL change OR just the overview selector to appear (faster)
      page.waitForURL(/\/mein-lidl-connect\/uebersicht(\.html)?$/, {
        timeout: 20000,
      }),
      page.click('form button[type="submit"]'),
    ]);

    // Action
    // Uses a specific text locator to fail fast if not found
    const refillBtn = page.getByRole("button", { name: /Refill aktivieren/i });

    // Short timeout: if it's not there quickly, something is wrong or already active
    await refillBtn.waitFor({ state: "visible", timeout: 5000 });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/graphql"), {
        timeout: 5000,
      }),
      refillBtn.click(),
    ]);

    console.log("✅ Success");
    process.exit(0);
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1); // Tells Cloud Run the task failed
  } finally {
    // Cleanup
    await context.close();
    await browser.close();
  }
})();
