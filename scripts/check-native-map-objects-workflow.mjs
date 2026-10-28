import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2), directory = await mkdtemp(join("node_modules", ".native-map-ui-"));
const imported = process.env.IMPORTED_MAP_OBJECTS === "1";
const server = createServer((_req, res) => res.end('<!doctype html><div id="root"></div>'));
let browser;
try {
  assert.ok(roots.length, "Supply Red/Yellow source directories.");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "session", setup(b) {
    b.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "session", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
  } }] });
  const script = await readFile(outfile, "utf8"), styles = (await Promise.all(["App.css", "MapNpcWizard.css", "MapScriptPreview.css", "MapEditing.css", "TextEditor.css", "editor/SearchableSelect.css"].map(p => readFile(join("src", p), "utf8")))).join("\n");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined });
  for (const root of roots) {
    const files = {}, bytes = {};
    async function collect(p = "") { for (const e of await readdir(join(root, p), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const path = join(p, e.name); if (e.isDirectory()) await collect(path); else if (path.endsWith(".asm")) files[path] = await readFile(join(root, path), "utf8"); else if (path.endsWith(".blk") || path.endsWith(".bst") || /^gfx\/tilesets\/.*\.png$/.test(path)) bytes[path] = Array.from(await readFile(join(root, path))); } }
    await collect();
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: width < 700 ? "dark" : "light" }), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes, imported }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "MT_MOON_1F"; window.importedMapObjects = imported; }, { files, bytes, imported });
      await page.addScriptTag({ content: script });
      await page.getByRole("button", { name: "Item 8 at 2, 20", exact: true }).waitFor();
      assert.equal(await page.locator(".world-map-npc-list > button").count(), 13);
      assert.equal(await page.locator(".world-map-trainer-marker").count(), 7); assert.equal(await page.locator(".world-map-item-marker").count(), 6);
      await page.getByRole("button", { name: "Item 8 at 2, 20", exact: true }).click();
      await page.getByRole("button", { name: "Edit item", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: /^Edit native item in/ });
      await dialog.getByLabel("Native pickup item", { exact: true }).selectOption("RARE_CANDY");
      const point = await page.evaluate(() => { const d = window.nativeObjectDocument; return d.placement.walkable.find(p => !d.placement.occupied.some(o => o.x === p.x && o.y === p.y) && (p.x !== d.values.x || p.y !== d.values.y)); });
      await dialog.getByLabel("Native object X", { exact: true }).fill(String(point.x)); await dialog.getByLabel("Native object Y", { exact: true }).fill(String(point.y));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save object", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(prefix => window.dialogueFiles["data/maps/objects/MtMoon1F.asm"].includes(`${prefix}POTION1, RARE_CANDY`), imported ? "IMPORTED_TEXT_" : "TEXT_MTMOON1F_");
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed")); });
      await page.getByRole("button", { name: "Item 8 at 2, 20", exact: true }).waitFor();
      await page.getByRole("button", { name: "Trainer 1 at 5, 6", exact: true }).click();
      await page.getByRole("button", { name: "Edit trainer", exact: true }).click();
      dialog = page.getByRole("dialog", { name: /^Edit native trainer in/ });
      await dialog.getByLabel("Native trainer party", { exact: true }).selectOption("YOUNGSTER:3");
      await dialog.getByLabel("Native trainer sight range", { exact: true }).fill("1");
      const challenge = dialog.locator(".text-editor-summary").filter({ hasText: "Challenge dialogue" });
      await challenge.getByRole("button", { name: "Edit text", exact: true }).click();
      const text = page.getByRole("dialog", { name: "Edit Challenge dialogue", exact: true });
      await text.locator("input[type=text], textarea").first().fill("Howdy!");
      await text.getByRole("button", { name: "Apply text", exact: true }).click(); await text.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save object", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(imported => window.dialogueFiles["data/maps/objects/MtMoon1F.asm"].includes(imported ? "IMPORTED_TEXT_HIKER, BATTLE_YOUNGSTER, 3" : "TEXT_MTMOON1F_HIKER, OPP_YOUNGSTER, 3"), imported);
      assert.ok(await page.evaluate(() => window.dialogueFiles["text/MtMoon1F.asm"].includes('text "Howdy!"')));
      if (imported) {
        await page.evaluate(() => { window.dialogueFiles["scripts/MtMoon1F.asm"] = window.dialogueFiles["scripts/MtMoon1F.asm"].replace(".other\n\tfarcall ImportedTrainerHelper", ".other\n\tld hl, MtMoon1TrainerHeader1\n\tcall TalkToTrainer"); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed")); });
        await page.getByRole("button", { name: "Edit trainer", exact: true }).click();
        dialog = page.getByRole("dialog", { name: /^Edit native trainer in/ });
        await dialog.getByLabel("Native trainer party", { exact: true }).selectOption("LASS:5");
        assert.equal(await dialog.getByLabel("Native trainer sight range", { exact: true }).isDisabled(), true);
        await dialog.getByRole("button", { name: "Save object", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
        assert.deepEqual(await page.evaluate(() => window.dialogueSaves.at(-1).map(w => w.path)), ["data/maps/objects/MtMoon1F.asm"]);
      }
      assert.deepEqual(errors, []); await page.close();
      console.log(`${root}: ${imported ? "imported hack" : "native"} objects, pickup placement, trainer party/sight/text and undo through Maps passed at ${width}px`);
    }
  }
} finally { await browser?.close(); server.close(); await rm(directory, { recursive: true, force: true }); }
