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
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: width < 700 ? "dark" : "light" }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.getByRole("button", { name: "Create map", exact: true }).click();
      const create = page.getByRole("dialog", { name: "Create map", exact: true });
      await create.getByLabel("New map constant", { exact: true }).fill("TEST_POPULATED_ROOM");
      await create.getByRole("button", { name: "Create map", exact: true }).click();
      await create.waitFor({ state: "hidden" });
      await page.locator(".world-map-title h3").filter({ hasText: /^Test Populated Room$/ }).waitFor();
      await page.getByRole("button", { name: "Assign encounters", exact: true }).click();
      const assignment = page.getByRole("dialog", { name: /^Assign encounters/ });
      await assignment.getByRole("button", { name: "Save encounter assignment", exact: true }).click();
      await assignment.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Open in Wild Encounters →", exact: true }).waitFor();
      await page.getByText("No active grass or surfing encounters.", { exact: true }).first().waitFor();
      const blank = await page.evaluate(() => window.dialogueSaves.at(-1).find(w => w.operation === "create"));
      assert.ok(blank.path.startsWith("data/wild/maps/TestPopulatedRoom"));
      assert.match(blank.contents, /def_grass_wildmons 0/);
      await page.getByRole("button", { name: "Assign encounters", exact: true }).click();
      await assignment.getByLabel("Encounter assignment", { exact: true }).selectOption("copy");
      await assignment.getByLabel("Encounter table", { exact: true }).selectOption("data/wild/maps/Route1.asm");
      assert.equal(await assignment.getByRole("button", { name: "Save encounter assignment", exact: true }).isDisabled(), true);
      await assignment.getByRole("checkbox", { name: /^Replace this map/ }).check();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await assignment.getByRole("button", { name: "Save encounter assignment", exact: true }).click();
      await assignment.waitFor({ state: "hidden" });
      const copied = await page.evaluate(() => window.dialogueSaves.at(-1).find(w => w.operation === "create"));
      assert.notEqual(copied.path, "data/wild/maps/Route1.asm");
      assert.match(copied.contents, /def_grass_wildmons 25/);
      await page.getByRole("button", { name: "Place item", exact: true }).click();
      const item = page.getByRole("dialog", { name: /^Place item in/ });
      await item.getByLabel("Pickup item", { exact: true }).selectOption("TM_DIG");
      await item.getByLabel("Pickup quantity", { exact: true }).fill("2");
      await item.getByLabel("Pickup X", { exact: true }).fill("1");
      await item.getByLabel("Pickup Y", { exact: true }).fill("1");
      await page.waitForFunction(() => window.dialogueDirty);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await item.getByRole("button", { name: "Place item", exact: true }).click();
      await item.waitFor({ state: "hidden" });
      await page.locator(".world-map-npc-list button").first().click();
      await page.locator(".world-map-npc-inspector").getByRole("button", { name: "Edit interaction", exact: true }).click();
      const interaction = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      assert.equal(await interaction.getByLabel("Reward item", { exact: true }).inputValue(), "TM_DIG");
      assert.equal(await interaction.getByLabel("Reward quantity", { exact: true }).inputValue(), "2");
      assert.equal(await interaction.getByLabel("Run once per save file", { exact: true }).isDisabled(), true);
      await interaction.getByLabel("Reward quantity", { exact: true }).fill("3");
      await interaction.getByRole("button", { name: "Save interaction", exact: true }).click();
      await interaction.waitFor({ state: "hidden" });
      await page.evaluate(() => { window.mapFocus = "TEST_POPULATED_ROOM"; });
      await page.getByRole("button", { name: "Reload scripts", exact: true }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Test Populated Room$/ }).waitFor();
      await page.locator(".world-map-npc-list button").first().click();
      await page.locator(".world-map-npc-inspector").getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await interaction.getByLabel("Reward quantity", { exact: true }).inputValue(), "3");
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: new map, empty/copy encounter assignment, independent files, replacement confirmation, item placement and reward save/reopen passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
