import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_err) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} never came up`);
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), "beachhead-test-"));
  const devProc = spawn("npm", ["run", "dev", "--", "--port", "5180", "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, npm_config_loglevel: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let devLog = "";
  devProc.stdout.on("data", d => { devLog += d.toString(); });
  devProc.stderr.on("data", d => { devLog += d.toString(); });

  try {
    await waitForServer("http://localhost:5180/");
    console.log("dev server up");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const consoleMessages = [];
    page.on("console", msg => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    const pageErrors = [];
    page.on("pageerror", err => {
      pageErrors.push({ message: err.message, stack: err.stack });
    });

    await page.goto("http://localhost:5180/", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /DEPLOY TO EMPLACEMENT/ }).click();
    await page.waitForTimeout(2500);
    if (!(await page.getByText("DEFENSE ACTIVE").isVisible())) {
      throw new Error("deploy did not enter the active battlefield");
    }

    const canvas = await page.$("canvas");
    if (!canvas) throw new Error("no <canvas> on the page");
    // Exercise the native cannon muzzle/smoke path, not just scene startup.
    await page.keyboard.press("2");
    await canvas.click({ position: { x: 640, y: 360 } });
    await page.waitForTimeout(180);
    await canvas.screenshot({ path: join(tmp, "after-fix.png") });
    await page.screenshot({ path: join(tmp, "page.png"), fullPage: false });

    const pixelStats = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return { error: "no canvas" };
      const off = document.createElement("canvas");
      off.width = c.width; off.height = c.height;
      const ctx = off.getContext("2d");
      if (!ctx) return { error: "no 2d ctx" };
      ctx.drawImage(c, 0, 0);
      const data = ctx.getImageData(0, 0, off.width, off.height).data;
      let nonBlack = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 8 || g > 8 || b > 8) nonBlack++;
        rSum += r; gSum += g; bSum += b;
      }
      const n = data.length / 4;
      return {
        total: n,
        nonBlack,
        nonBlackPct: nonBlack / n,
        avgR: rSum / n, avgG: gSum / n, avgB: bSum / n,
        cw: c.width, ch: c.height,
      };
    });
    console.log("canvas pixel stats:", pixelStats);

    await browser.close();

    await writeFile(join(tmp, "report.json"), JSON.stringify({
      devLogTail: devLog.split("\n").slice(-30).join("\n"),
      consoleMessages,
      pageErrors,
      pixelStats,
    }, null, 2));
    console.log("report at", join(tmp, "report.json"));
    console.log("screenshot at", join(tmp, "after-fix.png"));
    console.log("page screenshot at", join(tmp, "page.png"));

    const bad = consoleMessages.filter(m =>
      m.text.includes("DEPRECATED") ||
      m.text.includes("addComponent: ignoring unknown option") ||
      m.text.includes("vbData.set") ||
      m.text.includes("setHex")
    );
    if (bad.length) {
      console.error("FAIL: unexpected console errors:");
      for (const m of bad) console.error("  -", m.type, m.text);
    } else {
      console.log("PASS: no deprecation / unknown-option errors");
    }
    if (pageErrors.length) {
      console.error("FAIL: page errors:");
      for (const e of pageErrors) console.error("  -", e.message, e.stack ?? "");
    } else {
      console.log("PASS: no page errors");
    }
    if (pixelStats.error) {
      console.error("FAIL:", pixelStats.error);
    } else if (pixelStats.nonBlackPct < 0.05) {
      console.error(`FAIL: canvas is ${(pixelStats.nonBlackPct * 100).toFixed(2)}% non-black - looks empty`);
    } else {
      console.log(`PASS: canvas is ${(pixelStats.nonBlackPct * 100).toFixed(2)}% non-black, avg RGB (${pixelStats.avgR.toFixed(0)}, ${pixelStats.avgG.toFixed(0)}, ${pixelStats.avgB.toFixed(0)})`);
    }

    console.log("\n--- Last 40 console messages ---");
    for (const m of consoleMessages.slice(-40)) console.log(m.type, m.text);
  } finally {
    devProc.kill("SIGTERM");
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("test failed:", err);
  process.exit(1);
});
