import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".scene-choices-workflow-"));
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
      const page = activePage = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.sceneFixture = true; window.mapFocus = "VIRIDIAN_POKECENTER"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /Viridian/i }).waitFor();
      await page.locator(".world-map-npc-list button").last().click();
      const inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      const actions = dialog.getByRole("group", { name: "Actions", exact: true });
      async function add(group, label, kind) { await group.getByLabel(`${label} action type`, { exact: true }).selectOption(kind); await group.getByRole("button", { name: `${label} add action`, exact: true }).click(); }
      for (const flag of ["Fossil reward claimed", "Dome reward chosen"]) {
        await dialog.getByLabel("New shared flag name", { exact: true }).fill(flag);
        await dialog.getByRole("button", { name: "Add shared flag", exact: true }).click();
      }
      await add(actions, "Actions", "item");
      await actions.getByLabel("Actions Reward item", { exact: true }).selectOption("DOME_FOSSIL");
      await actions.getByLabel("Only one reward from this shared group", { exact: true }).check();
      await actions.getByLabel("Actions Reward group flag", { exact: true }).selectOption({ label: "Fossil reward claimed" });
      await actions.getByLabel("Actions Chosen option flag", { exact: true }).selectOption({ label: "Dome reward chosen" });
      await dialog.getByLabel("Start automatically at player start 1", { exact: true }).check();
      await dialog.getByLabel("Require a condition for the automatic trigger", { exact: true }).check();
      await dialog.getByLabel("Automatic trigger event", { exact: true }).selectOption({ label: "Fossil reward claimed" });
      await dialog.getByLabel("Automatic trigger event must be set (uncheck for clear)", { exact: true }).uncheck();
      await dialog.getByLabel("Scene player Y", { exact: true }).fill("4");
      await dialog.getByRole("button", { name: "Add player start", exact: true }).click();
      await dialog.getByLabel("Start automatically at player start 2", { exact: true }).check();
      await dialog.getByRole("button", { name: "Remove start 2", exact: true }).click();
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/Scene checks passed/).waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await actions.getByLabel("Actions Reward group flag", { exact: true }).inputValue(), "EVENT_EDITOR_SHARED_FOSSIL_REWARD_CLAIMED");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await actions.getByLabel("Actions Chosen option flag", { exact: true }).waitFor();
      assert.equal(await actions.getByLabel("Actions Chosen option flag", { exact: true }).inputValue(), "EVENT_EDITOR_SHARED_DOME_REWARD_CHOSEN");
      assert.equal(await dialog.getByLabel("Start automatically at player start 1", { exact: true }).isChecked(), true);
      await dialog.getByText(/Also starts automatically at \(4, 4\)/).waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      // Inspect the saved NPC's generated logic without changing tabs.
      await inspector.getByRole("button", { name: "Inspect map logic", exact: true }).click();
      const logic = page.getByRole("dialog", { name: "Map logic", exact: true });
      await logic.getByRole("heading", { name: "Map logic", exact: true, level: 2 }).waitFor();
      await logic.getByRole("button", { name: "Edit interaction", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.openedScript === undefined), true);
      assert.equal(await logic.locator(".script-browser-sidebar").isVisible(), false);
      await logic.getByRole("button", { name: "Close map logic", exact: true }).click();
      // A second NPC can use the shared flag without redeclaring it.
      await page.locator(".world-map-npc-list button").nth(2).click();
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      await add(actions, "Actions", "if-event");
      await actions.getByLabel("Actions Event condition", { exact: true }).selectOption({ label: "Fossil reward claimed" });
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      // The original Mt Moon state machine and both native gifts are available
      // from its map, without replacing its logic with generated actions.
      await page.getByPlaceholder("Search maps…", { exact: true }).fill("MT_MOON_B2F");
      await page.locator(".world-map-list button").first().click();
      await page.locator(".world-map-title h3").filter({ hasText: /Moon/i }).waitFor();
      await page.getByRole("button", { name: "Edit map logic", exact: true }).click();
      await logic.locator(".script-routine-list").getByText("MtMoonB2FDefaultScript", { exact: true }).waitFor();
      await logic.getByRole("button", { name: "Close map logic", exact: true }).click();
      await page.locator(".world-map-npc-list button").filter({ hasText: /Dome Fossil/i }).click();
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await dialog.getByLabel("Reward item", { exact: true }).inputValue(), "DOME_FOSSIL");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: shared flags, atomic linked reward, cross-NPC reuse, drafts, save/reopen, map-local logic and native fossil reward editing verified`);
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
