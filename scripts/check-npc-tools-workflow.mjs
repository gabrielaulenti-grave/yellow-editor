import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".npc-tools-workflow-"));
const server = createServer((_request, response) => response.end('<!doctype html><div id="root"></div>'));
let browser, activePage;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, plugins: [{ name: "fixture-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
    } }] });
  const script = await readFile(outfile, "utf8");
  const styles = (await Promise.all(["App.css", "MapNpcWizard.css", "MapScriptPreview.css", "TextEditor.css", "editor/SearchableSelect.css", "ScriptsTab.css"]
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
      const page = activePage = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: width < 700 ? "dark" : "light" });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.sceneFixture = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.locator(".world-map-npc-list button").last().click();
      const inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByLabel("Show this NPC only when a condition matches", { exact: true }).check();
      assert.equal(await dialog.getByLabel("NPC visibility condition type", { exact: true }).inputValue(), "not");
      assert.equal(await dialog.getByLabel("NPC visibility condition inverted check type", { exact: true }).inputValue(), "hall-of-fame");
      assert.equal(await dialog.getByLabel("Run once per save file", { exact: true }).isChecked(), false);
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const visibleSource = await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]);
      assert.match(visibleSource, /"visibleWhen":\{"kind":"not","condition":\{"kind":"hall-of-fame"\}\}/);
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByLabel("Require a condition", { exact: true }).check();
      await dialog.getByLabel("Interaction condition type", { exact: true }).selectOption("all");
      await dialog.getByLabel("Interaction condition check 1 type", { exact: true }).selectOption("party-species");
      await dialog.getByLabel("Interaction condition check 1 Pokémon", { exact: true }).selectOption("LAPRAS");
      await dialog.getByRole("button", { name: "Add condition check", exact: true }).click();
      await dialog.getByLabel("Interaction condition check 2 type", { exact: true }).selectOption("party-move");
      await dialog.getByLabel("Interaction condition check 2 move", { exact: true }).selectOption("SURF");
      const actions = dialog.getByRole("group", { name: "Actions", exact: true });
      async function add(group, label, kind) { await group.getByLabel(`${label} action type`, { exact: true }).selectOption(kind); await group.getByRole("button", { name: `${label} add action`, exact: true }).click(); }
      await add(actions, "Actions", "if-condition");
      await actions.getByLabel("Actions action 1 condition type", { exact: true }).selectOption("money");
      await actions.getByLabel("Actions action 1 condition amount", { exact: true }).fill("500");
      const yes = actions.getByRole("group", { name: "Actions 1 Then", exact: true }), no = actions.getByRole("group", { name: "Actions 1 Otherwise", exact: true });
      await add(yes, "Actions 1 Then", "transaction");
      await yes.getByLabel("Actions 1 Then action 1 service reward", { exact: true }).selectOption("item");
      await yes.getByLabel("Actions 1 Then Service reward quantity", { exact: true }).fill("2");
      await add(no, "Actions 1 Otherwise", "shop");
      await no.getByRole("button", { name: "Add shop item", exact: true }).click();
      await no.getByLabel("Actions 1 Otherwise Shop item 2", { exact: true }).selectOption("TM_DIG");
      await yes.getByLabel("Actions 1 Then Payment amount", { exact: true }).fill("0");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: /nonzero price/ }).waitFor();
      assert.equal(await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]), visibleSource);
      await yes.getByLabel("Actions 1 Then Payment amount", { exact: true }).fill("500");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await yes.getByLabel("Actions 1 Then Payment amount", { exact: true }).inputValue(), "500");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByLabel("Interaction condition check 2 move", { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("Interaction condition check 2 move", { exact: true }).inputValue(), "SURF");
      assert.equal(await no.getByLabel("Actions 1 Otherwise Shop item 2", { exact: true }).inputValue(), "TM_DIG");
      await dialog.getByLabel("Show this NPC only when a condition matches", { exact: true }).uncheck();
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await page.evaluate(() => window.dialogueFiles["engine/overworld/toggleable_objects.asm"])).includes("yellow-editor-npc-visibility-begin"), false);
      // Existing flag-only interactions can retain the default dialogue. Adding
      // a visibility filter must preserve their authored one-time behavior.
      await page.evaluate(async () => {
        const script = window.dialogueFiles["scripts/PalletTown.asm"];
        const model = JSON.parse(script.match(/yellow-editor-interaction: (.*)/)[1]);
        const document = await window.dialogueInvoke("get_script_interaction_document", { path: "scripts/PalletTown.asm", label: model.label });
        await window.dialogueInvoke("save_script_interaction", { document, values: { ...document.values, actions: undefined, once: true, visibleWhen: null, dialogue: ["Here you go!"], events: [{ event: "EVENT_GOT_TOWN_MAP", set: true }] } });
        window.dispatchEvent(new Event("yellow-editor:history-changed"));
      });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByLabel("Show this NPC only when a condition matches", { exact: true }).check();
      assert.equal(await dialog.getByLabel("Run once per save file", { exact: true }).isChecked(), true);
      assert.equal(await dialog.getByLabel("Interaction dialogue", { exact: true }).inputValue(), "Here you go!");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: conditional visibility, compound party/move checks, payment validation, stock, drafts and save/reopen passed`);
      await page.close();
    }
  }
} catch (error) {
  if (activePage) console.error((await activePage.locator('[role="dialog"]:visible, dialog[open]').allTextContents().catch(() => ["Page unavailable"])).join("\n").slice(-7000));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
