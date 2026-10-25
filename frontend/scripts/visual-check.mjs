/* global URL, localStorage, window, document, console */
// Run against scripts/ui_fixture.py only. No production data or remote sites.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "docs/screenshots/phase-3.7");
await mkdir(output, { recursive: true });
const base = "http://127.0.0.1:5178";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = [];
const errors = [];
const viewports = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [768, 1024],
  [375, 812],
];
const routes = [
  ["overview", "/"],
  ["opportunities", "/jobs"],
  ["applications", "/applications"],
  ["companies", "/companies"],
  ["import", "/imports"],
  ["archive", "/archive"],
  ["documents", "/documents"],
  ["settings", "/settings"],
];
try {
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("rolepilot-theme", theme);
      }, theme);
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        errors.push(`${theme}/${width}: ${error.message}`),
      );
      async function check(name) {
        await page.waitForLoadState("networkidle");
        const geometry = await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
            (el) => {
              const rect = el.getBoundingClientRect();
              return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
              };
            },
          ),
        }));
        const overflow =
          geometry.scrollWidth > width + 1 ||
          geometry.dialogs.some(
            (rect) =>
              rect.left < -1 ||
              rect.right > width + 1 ||
              rect.top < -1 ||
              rect.bottom > height + 1,
          );
        report.push({
          theme,
          width,
          height,
          screen: name,
          overflow,
          ...geometry,
        });
        if (overflow) errors.push(`Overflow: ${theme}/${width}/${name}`);
        if (
          [1440, 375].includes(width) ||
          ["overview", "opportunities"].includes(name)
        ) {
          await page.screenshot({
            path: path.join(output, `${name}-${theme}-${width}.png`),
            fullPage: geometry.dialogs.length === 0,
            animations: "disabled",
          });
        }
      }
      for (const [name, route] of routes) {
        await page.goto(base + route);
        await page.locator("main h1").waitFor();
        await check(name);
      }
      await page.goto(base + "/jobs");
      await page
        .getByRole("button", { name: "Table view", exact: true })
        .click();
      await page.getByRole("table").waitFor();
      await check("opportunities-table");
      await page
        .getByRole("button", { name: "Card view", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Machine Learning Engineer", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Requirements", exact: true })
        .click();
      await check("job-details");
      await page.keyboard.press("Escape");
      await page.goto(base + "/applications");
      await page
        .getByRole("button", { name: "Kanban view", exact: true })
        .click();
      await check("kanban");
      await page
        .getByRole("button", {
          name: "Machine Learning Engineer Fictional Orbit",
        })
        .click();
      await page.getByRole("heading", { name: "Stage & history" }).waitFor();
      await check("application-details");
      await page.keyboard.press("Escape");
      if (width === 375) {
        await page.getByRole("button", { name: "Toggle navigation" }).click();
        await check("mobile-navigation");
        await page.keyboard.press("Escape");
        if (
          !(await page
            .getByRole("button", { name: "Toggle navigation" })
            .evaluate((el) => el === document.activeElement))
        )
          errors.push("Mobile focus was not restored");
      }
      // The existing login component is rendered through an intercepted session discovery.
      // This is a UI fixture, not an authentication/security test.
      await page.route("**/api/auth/session", (route) =>
        route.fulfill({
          json: { auth_required: true, authenticated: false, csrf_token: null },
        }),
      );
      await page.goto(base + "/");
      await page.getByLabel("Username").waitFor();
      await check("login");
      await context.close();
      console.log(`Checked ${theme} ${width}×${height}`);
    }
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "verification.json"),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        checks: report.length,
        errors,
        report,
      },
      null,
      2,
    ),
  );
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(`${report.length} screen/theme/viewport checks passed.`);
