import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".scene-position-workflow-"));
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
      const actor = await page.evaluate(() => window.sceneActor);
      async function add(group, label, kind) { await group.getByLabel(`${label} action type`, { exact: true }).selectOption(kind); await group.getByRole("button", { name: `${label} add action`, exact: true }).click(); }
      await add(actions, "Actions", "if-position");
      await actions.getByLabel("Actions action 2 position test", { exact: true }).selectOption("relative");
      await actions.getByLabel("Actions Position reference NPC", { exact: true }).selectOption(actor);
      await actions.getByLabel("Actions action 2 position side", { exact: true }).selectOption("LEFT");
      for (const [branch, route] of [["Then", "UP"], ["Otherwise", "DOWN"]]) {
        const name = `Actions 2 ${branch}`, group = actions.getByRole("group", { name, exact: true });
        await add(group, name, "walk-npc");
        await group.getByLabel(`${name} Scene NPC`, { exact: true }).selectOption(actor);
        await group.getByLabel(`${name} action 1 route`, { exact: true }).fill(route);
      }
      await add(actions, "Actions", "face-npc");
      await actions.getByLabel("Actions Turning NPC", { exact: true }).selectOption(actor);
      await actions.getByLabel("Actions action 3 facing", { exact: true }).selectOption("PLAYER");
      await add(actions, "Actions", "face-player");
      await actions.getByLabel("Actions action 4 facing", { exact: true }).selectOption("NPC");
      await actions.getByLabel("Actions Facing target NPC", { exact: true }).selectOption(actor);
      await add(actions, "Actions", "if-position");
      await actions.getByLabel("Actions action 5 position X", { exact: true }).fill("3");
      await actions.getByLabel("Actions action 5 position Y", { exact: true }).fill("5");
      const then = actions.getByRole("group", { name: "Actions 5 Then", exact: true });
      await add(then, "Actions 5 Then", "dialogue");
      await then.getByLabel("Actions 5 Then action 1 dialogue", { exact: true }).fill("Left side.");
      await dialog.getByLabel("Scene player X", { exact: true }).fill("3");
      await dialog.getByLabel("Scene player Y", { exact: true }).fill("5");
      await dialog.getByRole("button", { name: "Add player start", exact: true }).click();
      await dialog.getByLabel("Scene start 2 player X", { exact: true }).fill("5");
      await dialog.getByLabel("Scene start 2 player Y", { exact: true }).fill("5");
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/Scene checks passed/).waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await then.getByLabel("Actions 5 Then action 1 dialogue", { exact: true }).inputValue(), "Left side.");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await actions.getByLabel("Actions action 2 position test", { exact: true }).inputValue(), "relative");
      assert.equal(await actions.getByLabel("Actions action 2 position side", { exact: true }).inputValue(), "LEFT");
      assert.equal(await actions.getByLabel("Actions action 3 facing", { exact: true }).inputValue(), "PLAYER");
      assert.equal(await actions.getByLabel("Actions action 4 facing", { exact: true }).inputValue(), "NPC");
      assert.equal(await actions.getByLabel("Actions action 5 position X", { exact: true }).inputValue(), "3");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: exact/relative position branches, alternate routes, reciprocal facing, draft recovery and save/reopen verified`);
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
