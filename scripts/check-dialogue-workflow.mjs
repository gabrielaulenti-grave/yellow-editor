import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply pinned Red/Yellow source directories for the dialogue UI check.");
const directory = await mkdtemp(join("node_modules", ".dialogue-ui-"));
let browser;
try {
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, plugins: [{ name: "fixture-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
    } }] });
  const styles = (await Promise.all(["App.css", "ScriptsTab.css", "MapScriptPreview.css", "TextEditor.css", "editor/SearchableSelect.css"]
    .map(path => readFile(join("src", path), "utf8")))).join("\n");
  const script = await readFile(outfile, "utf8");
  browser = await chromium.launch();
  for (const root of roots) {
    const original = {};
    for (const path of ["scripts/ViridianCity.asm", "scripts/ViridianCity_2.asm", "text/ViridianCity.asm", "scripts/Route1.asm", "text/Route1.asm", "text.asm"]) {
      try { original[path] = await readFile(join(root, path), "utf8"); }
      catch (error) { if (!path.endsWith("_2.asm")) throw error; }
    }
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(files => { window.dialogueFiles = files; }, original);
      await page.addScriptTag({ content: script });
      const preview = page.locator(".script-routine-details .text-editor-preview");
      await preview.filter({ hasText: "VIRIDIAN CITY" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Add action", exact: true }).count(), 0);
      assert.equal(await page.getByText(/No semantic operations are recognized/).count(), 0);
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit Dialogue" });
      await dialog.locator("textarea").first().waitFor();
      assert.equal(await dialog.locator("textarea").first().inputValue(), "VIRIDIAN CITY ");
      await dialog.locator("textarea").first().fill("WELCOME!");
      await page.waitForFunction(() => window.dialogueDirty === true);
      page.once("dialog", async confirmation => { await confirmation.dismiss(); });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await dialog.isVisible(), true, "Dirty text should survive a refused discard");
      await dialog.getByRole("button", { name: "Save text", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await preview.filter({ hasText: "WELCOME!" }).waitFor();
      const files = await page.evaluate(() => window.dialogueFiles);
      for (const [path, contents] of Object.entries(original)) {
        assert.equal(files[path], path === "text/ViridianCity.asm" ? contents.replace('text "VIRIDIAN CITY "', 'text "WELCOME!"') : contents,
          `${root} ${width}px: modified wrapper or neighbor source: ${path}`);
      }
      assert.equal(await page.evaluate(() => window.dialogueSaves.length), 1);
      await page.getByRole("button", { name: "Reload scripts", exact: true }).click();
      await preview.filter({ hasText: "WELCOME!" }).waitFor();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await dialog.locator("textarea").first().waitFor();
      assert.equal(await dialog.locator("textarea").first().inputValue(), "WELCOME!");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator(".script-group-list").getByRole("button", { name: /^Route 1/ }).click();
      await page.getByRole("searchbox", { name: "Search routines in all companion files" }).fill("Route1Youngster1Text");
      await page.locator(".script-routine-list button").filter({ hasText: "Route1Youngster1Text" }).click();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await page.getByText("This interaction has 4 dialogue paths.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Add action", exact: true }).count(), 0);
      await page.getByRole("searchbox", { name: "Search dialogue paths" }).fill("Potion");
      assert.ok(await dialog.locator(".text-editor-path-list button").count());
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: Scripts-tab sign edit/save/reload, byte preservation, dirty protection, and NPC branch picker passed`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
