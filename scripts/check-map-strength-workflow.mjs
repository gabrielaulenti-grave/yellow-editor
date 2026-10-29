import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-strength-ui-"));
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
      const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: width < 700 ? "dark" : "light", hasTouch: width < 700 }), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      async function start(map) {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
        await page.evaluate(({ files, bytes, map }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = map; }, { files, bytes, map });
        await page.addScriptTag({ content: script });
        await page.getByRole("button", { name: "Strength puzzles", exact: true }).waitFor();
      }
      await start("VICTORY_ROAD_1F");
      await page.getByRole("button", { name: "Strength puzzles", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: /Strength puzzles/ });
      await dialog.getByLabel("Target 1 X", { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("Target 1 X", { exact: true }).inputValue(), "17");
      assert.equal(await dialog.getByRole("button", { name: "Save Strength puzzles", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Place target 1 on map", exact: true }).click();
      await dialog.getByLabel("Place Strength puzzle point", { exact: true }).click({ position: { x: 56, y: 56 } });
      assert.equal(await dialog.getByLabel("Target 1 X", { exact: true }).inputValue(), "3");
      assert.equal(await dialog.getByLabel("Target 1 Y", { exact: true }).inputValue(), "3");
      const colors = await dialog.evaluate(d => ({ text: getComputedStyle(d).color, background: getComputedStyle(d).backgroundColor }));
      assert.notEqual(colors.text, colors.background);
      await dialog.getByRole("button", { name: "Save Strength puzzles", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.match(await page.evaluate(() => window.dialogueFiles["scripts/VictoryRoad1F.asm"]), /dbmapcoord 3, 3/);
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      assert.match(await page.evaluate(() => window.dialogueFiles["scripts/VictoryRoad1F.asm"]), /dbmapcoord 17, 13/);
      await start("BLUES_HOUSE");
      await page.getByRole("button", { name: "Strength puzzles", exact: true }).click();
      dialog = page.getByRole("dialog", { name: /Strength puzzles/ });
      await dialog.getByRole("button", { name: "Add boulder", exact: true }).click();
      await dialog.getByRole("button", { name: "Place boulder 1 on map", exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Add puzzle target", exact: true }).click();
      await dialog.getByLabel("Target 1 X", { exact: true }).fill("3");
      await dialog.getByLabel("Target 1 Y", { exact: true }).fill("3");
      await dialog.getByRole("button", { name: "Add terrain change", exact: true }).click();
      await dialog.getByLabel("Terrain change 1 block", { exact: true }).fill("1");
      await dialog.getByRole("button", { name: "Save Strength puzzles", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.match(await page.evaluate(() => window.dialogueFiles["scripts/BluesHouse.asm"]), /yellow-editor-strength:/);
      await page.getByRole("button", { name: "Strength puzzles", exact: true }).click();
      dialog = page.getByRole("dialog", { name: /Strength puzzles/ });
      await dialog.getByLabel("Target 1 X", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Save Strength puzzles", exact: true }).isDisabled(), true);
      await dialog.getByLabel("Target 1 X", { exact: true }).fill("4");
      await dialog.getByRole("button", { name: "Save Strength puzzles", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await page.evaluate(() => window.dialogueFiles["scripts/BluesHouse.asm"])).match(/call BluesHouseEditorStrength/g).length, 1);
      await page.getByRole("button", { name: "Map properties", exact: true }).click();
      const properties = page.getByRole("dialog", { name: /Map properties/ });
      await properties.getByLabel("Bicycle", { exact: true }).selectOption("allow");
      await properties.getByLabel("Teleport", { exact: true }).selectOption("allow");
      await properties.getByLabel("Lighting on entry", { exact: true }).selectOption("dark");
      await properties.getByRole("button", { name: "Save map properties", exact: true }).click();
      await properties.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Map properties", exact: true }).click();
      await properties.getByLabel("Bicycle", { exact: true }).waitFor();
      assert.equal(await properties.getByLabel("Bicycle", { exact: true }).inputValue(), "allow");
      assert.equal(await properties.getByLabel("Teleport", { exact: true }).inputValue(), "allow");
      await properties.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Check map", exact: true }).click();
      await page.getByRole("region", { name: "Map check results", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: native puzzle placement, creation, boulder addition, gate editing, persistence, history, map permissions and validation passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
