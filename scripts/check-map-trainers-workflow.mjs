import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-trainer-ui-"));
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
      await create.getByLabel("New map constant", { exact: true }).fill("TRAINER_UI_ROOM");
      await create.getByRole("button", { name: "Create map", exact: true }).click();
      await create.waitFor({ state: "hidden" });
      await page.locator(".world-map-title h3").filter({ hasText: /^Trainer Ui Room$/ }).waitFor();
      const partiesBefore = await page.evaluate(() => window.dialogueFiles["data/trainers/parties.asm"]);
      await page.getByRole("button", { name: "Place trainer", exact: true }).click();
      const trainer = page.getByRole("dialog", { name: /^Place trainer in/ });
      await trainer.getByLabel("Placed trainer class", { exact: true }).selectOption("LASS");
      const point = await page.evaluate(() => {
        const d = window.trainerDocument;
        return d.walkable.find(p => !d.occupied.some(o => o.x === p.x && o.y === p.y) && d.walkable.some(n => n.x === p.x && n.y === p.y + 1) && !d.occupied.some(o => o.x === p.x && o.y === p.y + 1));
      });
      assert.ok(point);
      await trainer.getByLabel("Trainer character", { exact: true }).selectOption("SPRITE_COOLTRAINER_F");
      await trainer.getByLabel("Trainer X", { exact: true }).fill(String(point.x));
      await trainer.getByLabel("Trainer Y", { exact: true }).fill(String(point.y));
      await trainer.getByLabel("Trainer facing", { exact: true }).selectOption("DOWN");
      await trainer.getByLabel("Trainer sight range", { exact: true }).fill("9");
      assert.equal(await trainer.getByRole("button", { name: "Place trainer", exact: true }).isDisabled(), true);
      await trainer.getByLabel("Trainer sight range", { exact: true }).fill("1");
      await trainer.getByLabel("Trainer before dialogue", { exact: true }).fill("Let's battle!");
      await trainer.getByLabel("Trainer defeat dialogue", { exact: true }).fill("You win!");
      await trainer.getByLabel("Trainer after dialogue", { exact: true }).fill("Good match!");
      assert.equal(await trainer.getByRole("checkbox", { name: "Copy the selected party into a new independent party", exact: true }).isChecked(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await trainer.getByRole("button", { name: "Place trainer", exact: true }).click();
      await trainer.waitFor({ state: "hidden" });
      const inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit trainer", exact: true }).waitFor();
      const first = await page.evaluate(() => JSON.parse(window.dialogueFiles["scripts/TrainerUiRoom.asm"].match(/; yellow-editor-map-trainers: (.+)/)[1]).trainers[0]);
      assert.notEqual(first.values.partyId, "LASS:1");
      assert.equal(first.values.sight, 1);
      assert.notEqual(await page.evaluate(() => window.dialogueFiles["data/trainers/parties.asm"]), partiesBefore);
      await inspector.getByRole("button", { name: "Edit trainer", exact: true }).click();
      const edit = page.getByRole("dialog", { name: /^Edit trainer in/ });
      assert.equal(await edit.getByLabel("Placed trainer party", { exact: true }).inputValue(), first.values.partyId);
      assert.equal(await edit.getByRole("checkbox", { name: "Copy the selected party into a new independent party", exact: true }).isChecked(), false);
      await edit.getByLabel("Trainer sight range", { exact: true }).fill("0");
      await edit.getByLabel("Trainer facing", { exact: true }).selectOption("UP");
      await edit.getByLabel("Trainer after dialogue", { exact: true }).fill("See you again!");
      await edit.getByRole("button", { name: "Save trainer", exact: true }).click();
      await edit.waitFor({ state: "hidden" });
      const second = await page.evaluate(() => JSON.parse(window.dialogueFiles["scripts/TrainerUiRoom.asm"].match(/; yellow-editor-map-trainers: (.+)/)[1]).trainers[0]);
      assert.equal(second.event, first.event); assert.equal(second.values.sight, 0);
      await inspector.getByRole("button", { name: "Edit trainer party", exact: true }).click();
      assert.equal(await page.evaluate(() => window.openedTrainerParty), first.values.partyId);
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      assert.equal(await page.evaluate(() => JSON.parse(window.dialogueFiles["scripts/TrainerUiRoom.asm"].match(/; yellow-editor-map-trainers: (.+)/)[1]).trainers[0].values.sight), 1);
      await page.evaluate(async () => { await window.dialogueInvoke("redo_map_fixture"); window.mapFocus = "TRAINER_UI_ROOM"; });
      await page.getByRole("button", { name: "Reload scripts", exact: true }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Trainer Ui Room$/ }).waitFor();
      await page.locator(".world-map-npc-list button").first().click();
      await inspector.getByRole("button", { name: "Edit trainer", exact: true }).click();
      assert.equal(await edit.getByLabel("Trainer after dialogue", { exact: true }).inputValue(), "See you again!");
      assert.equal(await edit.getByLabel("Trainer sight range", { exact: true }).inputValue(), "0");
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: independent trainer party, placement, sight validation, dialogue, existing-party navigation, edit/save/reopen and undo/redo passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
