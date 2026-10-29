import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const temporary = await mkdtemp(join("node_modules", ".field-tools-ui-"));
const server = createServer((_request, response) => response.end('<!doctype html><div id="root"></div>'));
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(temporary, "fixture.js");
  await build({ entryPoints: ["tests/fieldToolWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic", loader: { ".css": "empty" } });
  const script = await readFile(outfile, "utf8"), styles = (await Promise.all(["App.css", "MapEditing.css", "editor/SearchableSelect.css"].map(p => readFile(join("src", p), "utf8")))).join("\n");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined });
  for (const root of roots) {
    const files = {};
    async function collect(folder = "") { for (const e of await readdir(join(root, folder), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = join(folder, e.name); if (e.isDirectory()) await collect(p); else if (p.endsWith(".asm")) files[p] = await readFile(join(root, p), "utf8"); } }
    await collect();
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: width < 700 ? "dark" : "light" }), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(files => { window.fieldFiles = files; }, files);
      await page.addScriptTag({ content: script });
      const wizard = page.getByRole("dialog", { name: "Add Item", exact: true });
      await wizard.getByLabel("Item slot", { exact: true }).waitFor();
      const nextId = await page.evaluate(() => window.fieldDocument.slots.find(s => s.append).id);
      await wizard.getByLabel("Item slot", { exact: true }).selectOption(String(nextId));
      await wizard.getByLabel("Assembly Constant", { exact: true }).fill("TEST_LANTERN");
      await wizard.getByLabel("Display Name", { exact: true }).fill("LANTERN");
      await wizard.getByRole("button", { name: "Next", exact: true }).click();
      await wizard.getByRole("button", { name: /^Field tool/ }).click();
      await wizard.getByLabel("Field action", { exact: true }).selectOption("flash");
      assert.equal(await wizard.getByLabel("Required badge", { exact: true }).inputValue(), "");
      assert.equal(await wizard.getByLabel("Require the party move", { exact: true }).isChecked(), false);
      assert.equal(await wizard.getByLabel("Consume field tool", { exact: true }).isChecked(), false);
      await wizard.getByLabel("Field tool invalid message", { exact: true }).fill("too long ".repeat(4));
      assert.equal(await wizard.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
      await wizard.getByLabel("Field tool invalid message", { exact: true }).fill("No darkness here.");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await wizard.getByRole("button", { name: "Next", exact: true }).click();
      await wizard.getByRole("button", { name: "Add Item", exact: true }).click();
      await wizard.waitFor({ state: "hidden" });
      await page.getByRole("heading", { name: "LANTERN", exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.fieldReadItem())).fieldTool.action, "flash");
      await page.getByLabel("Field action", { exact: true }).selectOption("fly");
      await page.getByLabel("All Fly destinations", { exact: true }).check();
      await page.getByLabel("Required badge", { exact: true }).selectOption("THUNDER");
      await page.getByLabel("Require the party move", { exact: true }).check();
      await page.getByLabel("Consume field tool", { exact: true }).check();
      await page.getByRole("button", { name: "Save field tool", exact: true }).click();
      await page.waitForFunction(async () => (await window.fieldReadItem()).fieldTool.action === "fly");
      await page.evaluate(() => window.fieldUndo());
      assert.equal((await page.evaluate(() => window.fieldReadItem())).fieldTool.action, "flash");
      await page.evaluate(() => window.fieldRedo());
      await page.getByRole("button", { name: "Reload field tool", exact: true }).click();
      await page.getByLabel("All Fly destinations", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Required badge", { exact: true }).inputValue(), "THUNDER");
      assert.equal(await page.getByLabel("All Fly destinations", { exact: true }).isChecked(), true);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: extended item creation, field action, messages, validation, requirements, edit/reload and undo/redo passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
