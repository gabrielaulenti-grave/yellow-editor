import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-edit-ui-"));
const server = createServer((_request, response) => response.end('<!doctype html><div id="root"></div>'));
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, plugins: [{ name: "fixture-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
    } }] });
  const script = await readFile(outfile, "utf8");
  const styles = (await Promise.all(["App.css", "MapNpcWizard.css", "MapScriptPreview.css", "MapEditing.css", "TextEditor.css", "editor/SearchableSelect.css"].map(path => readFile(join("src", path), "utf8")))).join("\n");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined });
  for (const root of roots) {
    const files = {}, bytes = {};
    async function collect(folder = "") {
      for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await collect(path);
        else if (path.endsWith(".asm")) files[path] = await readFile(join(root, path), "utf8");
        else if (path.endsWith(".blk") || path.endsWith(".bst") || /^gfx\/tilesets\/.*\.png$/.test(path)) bytes[path] = Array.from(await readFile(join(root, path)));
      }
    }
    await collect();
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.getByRole("button", { name: "Edit terrain", exact: true }).click();
      let terrain = page.getByRole("dialog", { name: /Edit terrain/ });
      await terrain.getByLabel("Selected block", { exact: true }).waitFor();
      const layout = bytes["maps/PalletTown.blk"].slice();
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      await terrain.getByLabel("Pick block from map", { exact: true }).check();
      await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: 2 * 32 + 16, y: 32 + 16 } });
      assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), String(layout[12]));
      await terrain.getByLabel("Pick block from map", { exact: true }).uncheck();
      await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: 48, y: 176 } });
      await terrain.getByRole("button", { name: "Undo stroke", exact: true }).click();
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      await terrain.getByRole("button", { name: "Redo stroke", exact: true }).click();
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        await terrain.getByLabel("Selected block", { exact: true }).selectOption(String(layout[(1 + y) * 10 + 2 + x]));
        await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: (1 + x) * 32 + 16, y: (5 + y) * 32 + 16 } });
        layout[(5 + y) * 10 + 1 + x] = bytes["maps/PalletTown.blk"][(1 + y) * 10 + 2 + x];
      }
      await page.waitForFunction(() => window.dialogueDirty);
      page.once("dialog", confirm => confirm.dismiss()); await terrain.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await terrain.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.MAP_EDIT_SCREENSHOT && width === 1280) await page.screenshot({ path: process.env.MAP_EDIT_SCREENSHOT });
      await terrain.getByRole("button", { name: "Save terrain", exact: true }).click(); await terrain.waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => window.dialogueBytes["maps/PalletTown.blk"]), layout);
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      assert.deepEqual(await page.evaluate(() => window.dialogueBytes["maps/PalletTown.blk"]), bytes["maps/PalletTown.blk"]);
      await page.evaluate(async () => { await window.dialogueInvoke("redo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });

      await page.getByRole("button", { name: "Edit terrain", exact: true }).click(); terrain = page.getByRole("dialog", { name: /Edit terrain/ });
      await terrain.locator("summary").click();
      const oldBlockset = bytes["gfx/blocksets/overworld.bst"], newId = oldBlockset.length / 16;
      await terrain.getByRole("button", { name: "Duplicate selected block", exact: true }).click();
      assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), String(newId));
      await terrain.getByLabel("Selected tile", { exact: true }).selectOption(oldBlockset[0] === 0 ? "1" : "0");
      await terrain.getByLabel("Paint tiles inside block", { exact: true }).click({ position: { x: 24, y: 24 } });
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      await terrain.getByLabel("I understand that blockset changes are shared by all maps using this blockset.", { exact: true }).check();
      await terrain.getByRole("button", { name: "Save terrain", exact: true }).click(); await terrain.waitFor({ state: "hidden" });
      const editedBlocks = await page.evaluate(() => window.dialogueBytes["gfx/blocksets/overworld.bst"]);
      assert.deepEqual(editedBlocks.slice(0, oldBlockset.length), oldBlockset);
      assert.equal(editedBlocks.length, oldBlockset.length + 16);

      await page.getByRole("button", { name: "Add warp", exact: true }).click();
      const warpDialog = page.getByRole("dialog", { name: /Add warp/ });
      await warpDialog.getByLabel("Warp X", { exact: true }).fill("3"); await warpDialog.getByLabel("Warp Y", { exact: true }).fill("13");
      await warpDialog.getByLabel("Destination map", { exact: true }).selectOption("BLUES_HOUSE");
      await warpDialog.getByLabel("Create a new return warp in the destination", { exact: true }).check();
      await warpDialog.getByLabel("Place return warp", { exact: true }).click({ position: { x: 88, y: 88 } });
      assert.equal(await warpDialog.getByLabel("Return warp X", { exact: true }).inputValue(), "5");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await warpDialog.getByRole("button", { name: "Save entrance and return", exact: true }).click(); await warpDialog.waitFor({ state: "hidden" });
      const pair = await page.evaluate(() => window.dialogueSaves.at(-1)); assert.equal(pair.length, 2);
      assert.match(pair[0].contents, /warp_event 3, 13, BLUES_HOUSE, 3/); assert.match(pair[1].contents, /warp_event 5, 5, PALLET_TOWN, 4/);
      await page.locator(".world-map-warp-list button").last().click();
      await page.getByRole("button", { name: "Edit selected warp", exact: true }).click();
      const editWarp = page.getByRole("dialog", { name: /Edit warp #4/ });
      await editWarp.getByLabel("Warp X", { exact: true }).fill("-1");
      await editWarp.getByRole("button", { name: "Save warp", exact: true }).click();
      await editWarp.getByRole("alert").filter({ hasText: /Warp X/ }).waitFor();
      await editWarp.getByLabel("Warp X", { exact: true }).fill("4");
      await editWarp.getByRole("button", { name: "Save warp", exact: true }).click(); await editWarp.waitFor({ state: "hidden" });
      await page.locator(".world-map-warp-list button").last().click();
      await page.locator(".world-map-warp-inspector").getByRole("button", { name: /^Go to / }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Blues House$/ }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: house painting, stroke undo/redo, custom block tiles, binary history, paired warp creation, validation, editing and navigation passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
