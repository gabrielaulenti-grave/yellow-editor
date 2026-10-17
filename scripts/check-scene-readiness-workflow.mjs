import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".scene-readiness-workflow-"));
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
      const page = activePage = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.sceneFixture = true; window.mapFocus = "VIRIDIAN_POKECENTER"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /Viridian/i }).waitFor();
      async function selectNpc() { await page.locator(".world-map-npc-list button").last().click(); }
      await selectNpc();
      let inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit NPC", exact: true }).click();
      let npc = page.getByRole("dialog", { name: /Edit NPC/ });
      await npc.getByLabel("NPC character", { exact: true }).selectOption("SPRITE_SNORLAX");
      await npc.getByText("Stationary sprite: one pose, no walking animation. Dialogue, visibility, emotes and battles are available.", { exact: true }).waitFor();
      assert.equal(await npc.getByLabel("NPC movement", { exact: true }).inputValue(), "STAY");
      assert.equal(await npc.getByLabel("NPC movement", { exact: true }).locator('option[value="WALK"]').evaluate(option => option.disabled), true);
      await npc.getByRole("button", { name: "Save NPC", exact: true }).click(); await npc.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      let actions = dialog.getByRole("group", { name: "Actions", exact: true });
      await actions.getByLabel("Actions action 1 dialogue", { exact: true }).fill("Keep this scene!");
      async function add(kind) { await actions.getByLabel("Actions action type", { exact: true }).selectOption(kind); await actions.getByRole("button", { name: "Actions add action", exact: true }).click(); }
      await add("wild-battle");
      await actions.getByLabel("Actions Encounter Pokémon", { exact: true }).selectOption("SNORLAX");
      await actions.getByLabel("Actions Encounter level", { exact: true }).fill("35");
      await add("visibility");
      const actor = await page.evaluate(() => window.sceneActor);
      await actions.getByLabel("Actions Scene NPC", { exact: true }).selectOption(actor);
      await actions.getByLabel("Visible (uncheck to hide)", { exact: true }).uncheck();
      await dialog.getByLabel("Scene trigger", { exact: true }).selectOption("coordinate");
      await dialog.getByLabel("Scene player X", { exact: true }).fill("-1");
      await dialog.getByLabel("Scene player Y", { exact: true }).fill("6");
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText("Problem tile: (-1, 6) is outside this map.", { exact: true }).waitFor();
      const before = await page.evaluate(() => window.dialogueSaves.length);
      await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.dialogueSaves.length), before, "Keeping an invalid draft writes no assembly");
      // A reload represents reopening the same project. Its committed source is
      // supplied again; drafts must come from persistent browser storage.
      const committed = await page.evaluate(() => window.dialogueFiles);
      async function reload(projectKey) {
        await page.reload();
        await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
        await page.evaluate(({ files, bytes, actor, projectKey }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "VIRIDIAN_POKECENTER"; window.sceneActor = actor; window.projectKey = projectKey; }, { files: committed, bytes, actor, projectKey });
        await page.addScriptTag({ content: script });
        await page.locator(".world-map-title h3").filter({ hasText: /Viridian/i }).waitFor(); await selectNpc();
        inspector = page.locator(".world-map-npc-inspector");
        await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
        dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      }
      await reload("other-project");
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Resume draft", exact: true }).count(), 0, "Drafts cannot leak between projects");
      await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await reload("dialogue-fixture");
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await dialog.getByLabel("Actions action 1 dialogue", { exact: true }).inputValue(), "Keep this scene!");
      assert.equal(await dialog.getByLabel("Actions Encounter level", { exact: true }).inputValue(), "35");
      await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      // Repair the actor outside the interaction editor without losing its draft.
      await inspector.getByRole("button", { name: "Edit NPC", exact: true }).click(); npc = page.getByRole("dialog", { name: /Edit NPC/ });
      await npc.getByLabel("NPC character", { exact: true }).selectOption("SPRITE_OAK");
      await npc.getByLabel("NPC Y", { exact: true }).fill("4");
      await npc.getByRole("button", { name: "Save NPC", exact: true }).click(); await npc.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      await dialog.getByText(/The project changed while this draft was closed/).waitFor();
      await dialog.getByLabel("Scene player X", { exact: true }).fill("4");
      actions = dialog.getByRole("group", { name: "Actions", exact: true });
      await add("walk-npc");
      const walk = dialog.locator('[data-scene-action="Action4"]');
      await walk.getByLabel("Actions Scene NPC", { exact: true }).selectOption(actor);
      await walk.getByLabel("Actions action 4 route", { exact: true }).fill("UP");
      await actions.getByRole("button", { name: "Actions move action 4 up", exact: true }).click();
      await actions.getByRole("button", { name: "Actions move action 3 up", exact: true }).click();
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/The NPC route is blocked at \(4, 3\)/).waitFor();
      await dialog.getByRole("button", { name: "Go to action", exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-scene-action") === "Action2");
      await dialog.getByLabel("Actions action 2 route", { exact: true }).fill("DOWN");
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/Scene checks passed/).waitFor();
      // A failed autosave must leave the form open, including when Close retries.
      await page.evaluate(() => { window.originalDraftPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException("Fixture storage full", "QuotaExceededError"); }; });
      await dialog.getByLabel("Actions action 1 dialogue", { exact: true }).fill("Still keep this!");
      await dialog.getByText(/Could not keep draft/).waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForFunction(() => { const close = document.querySelector('.text-editor-dialog-heading button'); return close && !close.disabled; });
      assert.equal(await dialog.isVisible(), true, "A failed Close keeps the interaction open");
      await dialog.getByText(/Your editor is still open/).waitFor();
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalDraftPut; });
      await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await dialog.getByLabel("Actions action 1 dialogue", { exact: true }).inputValue(), "Still keep this!");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByLabel("Actions action 1 dialogue", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Resume draft", exact: true }).count(), 0, "A committed interaction clears its draft");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: stationary picker, invalid draft persistence, reload/project isolation, NPC repair, action/tile diagnostics, storage failure recovery and final save verified`);
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
