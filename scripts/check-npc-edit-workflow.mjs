import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".npc-edit-workflow-"));
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
  const styles = (await Promise.all(["App.css", "MapNpcWizard.css", "MapScriptPreview.css", "TextEditor.css", "editor/SearchableSelect.css"]
    .map(path => readFile(join("src", path), "utf8")))).join("\n");
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
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.sceneFixture = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.locator(".world-map-npc-list button").last().click();
      const inspector = page.locator(".world-map-npc-inspector");
      const originalScript = await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]);
      await inspector.getByRole("button", { name: "Edit NPC", exact: true }).click();
      const editDialog = page.getByRole("dialog", { name: /Edit NPC/ });
      await editDialog.getByLabel("NPC X", { exact: true }).waitFor();
      assert.equal(await editDialog.getByLabel("NPC X", { exact: true }).inputValue(), "8");
      assert.equal(await editDialog.getByLabel("NPC Y", { exact: true }).inputValue(), "8");
      assert.equal(await editDialog.getByRole("button", { name: "Save NPC", exact: true }).isDisabled(), true);
      await editDialog.getByLabel("NPC X", { exact: true }).fill("-1");
      await editDialog.getByText("Choose a whole-number position inside the map.", { exact: true }).waitFor();
      assert.equal(await editDialog.getByRole("button", { name: "Save NPC", exact: true }).isDisabled(), true);
      const placement = editDialog.locator(".npc-placement-map .world-map-stage");
      await placement.click({ position: { x: 9 * 16 + 8, y: 8 * 16 + 8 } });
      await editDialog.getByLabel("NPC character", { exact: true }).selectOption("SPRITE_YOUNGSTER");
      await editDialog.getByLabel("NPC direction", { exact: true }).selectOption("LEFT");
      await page.waitForFunction(() => window.dialogueDirty === true);
      page.once("dialog", confirmation => confirmation.dismiss());
      await editDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await editDialog.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await editDialog.getByRole("button", { name: "Save NPC", exact: true }).click();
      await editDialog.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]), originalScript);
      const basicEdit = await page.evaluate(() => window.dialogueSaves.at(-1));
      assert.deepEqual(basicEdit.map(write => write.path), ["data/maps/objects/PalletTown.asm"]);
      await page.locator(".world-map-npc-inspector").getByText("x 9, y 8", { exact: true }).waitFor();
      await inspector.getByRole("button", { name: "Edit NPC", exact: true }).click();
      assert.equal(await editDialog.getByLabel("NPC X", { exact: true }).inputValue(), "9");
      assert.equal(await editDialog.getByLabel("NPC direction", { exact: true }).inputValue(), "LEFT");
      await page.keyboard.press("Escape"); await editDialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      await dialog.getByLabel("Show the original dialogue first", { exact: true }).uncheck();
      await dialog.getByLabel("Use a scene for movement, effects, battles or coordinate triggers", { exact: true }).check();
      await dialog.getByLabel("Scene trigger", { exact: true }).selectOption("coordinate");
      assert.equal(await dialog.getByLabel("Scene player X", { exact: true }).inputValue(), "9");
      assert.equal(await dialog.getByLabel("Scene player Y", { exact: true }).inputValue(), "9");
      const actor = await page.evaluate(() => window.sceneActor);
      await dialog.getByLabel(/PALLET TOWN EDITOR NPC/).check();
      const actions = dialog.getByRole("group", { name: "Actions", exact: true });
      await actions.getByLabel("Actions action type", { exact: true }).selectOption("visibility");
      await actions.getByRole("button", { name: "Actions add action", exact: true }).click();
      await actions.getByLabel("Actions Scene NPC", { exact: true }).selectOption(actor);
      await actions.getByLabel("Actions action type", { exact: true }).selectOption("follow-npc");
      await actions.getByRole("button", { name: "Actions add action", exact: true }).click();
      await actions.getByLabel("Actions Scene NPC", { exact: true }).last().selectOption(actor);
      const route = actions.getByLabel("Actions action 3 route", { exact: true });
      await route.fill(""); await route.pressSequentially("LEFT, UP");
      assert.equal(await route.inputValue(), "LEFT, UP", "Route editing preserves separators while typing");
      await page.waitForFunction(() => window.dialogueDirty === true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const saved = await page.evaluate(() => window.dialogueSaves.at(-1));
      assert.ok(saved.some(write => write.path === "ram/wram.asm"));
      assert.ok(saved.some(write => write.path === "engine/overworld/toggleable_objects.asm"));
      const metadata = JSON.parse(saved.find(write => write.path === "scripts/PalletTown.asm").contents.match(/yellow-editor-interaction: (.*)/)[1]);
      assert.equal(metadata.version, 3); assert.deepEqual(metadata.values.scene.hiddenNpcs, [actor]);
      assert.deepEqual(metadata.values.actions.at(-1).steps, ["LEFT", "UP"]);
      await page.locator(".world-map-npc-inspector").getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await dialog.getByLabel("Scene trigger", { exact: true }).inputValue(), "coordinate");
      assert.equal(await dialog.getByLabel("Actions action 3 route", { exact: true }).inputValue(), "LEFT, UP");
      assert.equal(await page.evaluate(() => window.dialogueDirty), false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await inspector.getByRole("button", { name: "Edit NPC", exact: true }).click();
      await editDialog.getByText("Linked scenes", { exact: true }).waitFor();
      assert.equal(await editDialog.getByLabel("Move linked player starts and coordinate triggers by the same offset", { exact: true }).isChecked(), true);
      await editDialog.getByLabel("NPC X", { exact: true }).fill("8");
      await editDialog.getByRole("button", { name: "Save NPC", exact: true }).click();
      await editDialog.waitFor({ state: "hidden" });
      const sceneEdit = await page.evaluate(() => window.dialogueSaves.at(-1));
      assert.deepEqual(sceneEdit.map(write => write.path).sort(), ["data/maps/objects/PalletTown.asm", "scripts/PalletTown.asm"]);
      const moved = JSON.parse(sceneEdit.find(write => write.path === "scripts/PalletTown.asm").contents.match(/yellow-editor-interaction: (.*)/)[1]);
      assert.deepEqual(moved.values.actions, metadata.values.actions);
      assert.equal(moved.values.scene.playerX, 8); assert.equal(moved.values.scene.playerY, 9);
      assert.equal(moved.scene.actors.find(entry => entry.constant === actor).x, 8);
      await page.locator(".world-map-npc-inspector").getByText("x 8, y 8", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: NPC placement, sprite/facing, dirty discard, preserved dialogue/actions, linked scene translation, save/reopen and responsive layout verified`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
