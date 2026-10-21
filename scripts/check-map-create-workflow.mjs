import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-create-ui-"));
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
      await page.getByRole("button", { name: "Create map", exact: true }).click();
      const wizard = page.getByRole("dialog", { name: "Create map", exact: true });
      await wizard.getByLabel("New map constant", { exact: true }).fill("PALLET_NEW_HOUSE");
      await wizard.getByLabel("Connect to Pallet Town now with entrance and return warps", { exact: true }).check();
      await wizard.getByLabel("New map entrance X", { exact: true }).fill("3");
      await wizard.getByLabel("New map entrance Y", { exact: true }).fill("13");
      await page.waitForFunction(() => window.dialogueDirty);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await wizard.getByRole("button", { name: "Create map", exact: true }).click();
      await wizard.waitFor({ state: "hidden" });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet New House$/ }).waitFor();
      await page.getByRole("button", { name: "Edit terrain", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.dialogueFiles["scripts/PalletNewHouse.asm"].includes("BluesHouse")), false);
      assert.ok((await page.evaluate(() => window.dialogueSaves.at(-1))).filter(write => write.operation === "create").length === 4);
      await page.locator(".world-map-warp-list button").first().click();
      await page.locator(".world-map-warp-inspector").getByRole("button", { name: /^Go to / }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.locator(".world-map-warp-list button").last().click();
      await page.locator(".world-map-warp-inspector").getByRole("button", { name: /^Go to / }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet New House$/ }).waitFor();
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      assert.equal(await page.evaluate(() => "maps/PalletNewHouse.blk" in window.dialogueBytes), false);
      await page.evaluate(async () => { await window.dialogueInvoke("redo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      await page.getByRole("button", { name: "Create map", exact: true }).click();
      await wizard.getByLabel("New map constant", { exact: true }).fill("TEST_BLANK_ROOM");
      await wizard.getByLabel("Starting terrain", { exact: true }).selectOption("blank");
      await wizard.getByLabel("New map width", { exact: true }).fill("64");
      await wizard.getByLabel("New map height", { exact: true }).fill("64");
      assert.equal(await wizard.getByRole("button", { name: "Create map", exact: true }).isDisabled(), true);
      await wizard.getByLabel("New map width", { exact: true }).fill("5");
      await wizard.getByLabel("New map height", { exact: true }).fill("6");
      await wizard.getByRole("button", { name: "Create map", exact: true }).click();
      await wizard.waitFor({ state: "hidden" });
      await page.locator(".world-map-title h3").filter({ hasText: /^Test Blank Room$/ }).waitFor();
      assert.equal(await page.evaluate(() => window.dialogueBytes["maps/TestBlankRoom.blk"].length), 30);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: map creation, independent files, reciprocal navigation, selection refresh, undo/redo removal and custom dimensions passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
