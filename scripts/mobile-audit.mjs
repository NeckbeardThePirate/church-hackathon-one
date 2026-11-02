import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.SCREENSHOT_DIR ?? "/opt/cursor/artifacts/screenshots/after";

const deviceList = [
  { name: "iphone-se", ...devices["iPhone SE"] },
  { name: "iphone-15", ...devices["iPhone 15"] },
  { name: "pixel-7", ...devices["Pixel 7"] },
  { name: "ipad-mini", ...devices["iPad Mini"] },
];

async function auditPage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const overflowX = Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null;
    const themeColor =
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
    const smallInputs = [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const fs = parseFloat(style.fontSize);
        return fs > 0 && fs < 16;
      })
      .map((el) => ({
        tag: el.tagName,
        fontSize: window.getComputedStyle(el).fontSize,
      }));
    return {
      overflowX,
      viewportMeta,
      themeColor,
      smallInputCount: smallInputs.length,
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
    };
  });
}

async function signInDev(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const devBtn = page.getByRole("button", { name: /Continue on this computer/i });
  if (await devBtn.isVisible().catch(() => false)) {
    await devBtn.click();
    await page.waitForTimeout(1500);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  for (const device of deviceList) {
    const context = await browser.newContext({ ...device, baseURL: BASE });
    const page = await context.newPage();

    const shots = [
      { name: "sign-in", fn: async () => page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" }) },
      { name: "sign-up", fn: async () => page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded" }) },
      {
        name: "picker",
        fn: async () => {
          await signInDev(page);
          await page.waitForSelector("text=What are you working on?", { timeout: 20000 });
        },
      },
      {
        name: "learn-intake",
        fn: async () => {
          await page.getByRole("button", { name: /Build a step-by-step learning plan/i }).click();
          await page.waitForSelector("text=What do you want to learn?", { timeout: 10000 });
        },
      },
    ];

    for (const shot of shots) {
      await shot.fn();
      await page.waitForTimeout(600);
      const file = `${device.name}-${shot.name}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      report.push({ device: device.name, route: shot.name, audit: await auditPage(page), screenshot: file });
    }

    // Mock learn plan overview (MOCK_AI=1)
    await page.getByPlaceholder(/book of Romans/i).fill("Grace and faith in Paul");
    await page.getByRole("button", { name: /Build my plan/i }).click();
    await page.waitForSelector("text=Putting your plan together", { timeout: 15000 }).catch(() => {});
    await page.waitForSelector("text=Course goals", { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(800);
    const planFile = `${device.name}-learn-plan-overview.png`;
    await page.screenshot({ path: path.join(OUT, planFile), fullPage: true });
    report.push({ device: device.name, route: "learn-plan-overview", audit: await auditPage(page), screenshot: planFile });

    await context.close();
  }

  await writeFile(path.join(OUT, "audit-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  const bad = report.filter((r) => r.audit.overflowX > 2 || r.audit.smallInputCount > 0);
  console.log("Issues:", bad.length);
  console.log(JSON.stringify(bad, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
