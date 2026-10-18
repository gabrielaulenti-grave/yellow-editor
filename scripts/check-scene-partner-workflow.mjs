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
      const yellow = Boolean(files["home/pikachu.asm"]);
      assert.equal(await actions.getByLabel("Actions action type", { exact: true }).locator('option[value="if-partner"]').evaluate(option => option.disabled), !yellow);
      if (!yellow) { await actions.getByText(/Pikachu actions require Yellow's follower engine/).waitFor(); await dialog.getByRole("button", { name: "Close", exact: true }).click(); await page.close(); continue; }
      async function add(group, label, kind) { await group.getByLabel(`${label} action type`, { exact: true }).selectOption(kind); await group.getByRole("button", { name: `${label} add action`, exact: true }).click(); }
      await add(actions, "Actions", "if-partner");
      const following = actions.getByRole("group", { name: "Actions 2 Following", exact: true });
      await add(following, "Actions 2 Following", "partner-move");
      await following.getByLabel("Actions 2 Following action 1 partner X", { exact: true }).fill("3");
      await following.getByLabel("Actions 2 Following action 1 partner Y", { exact: true }).fill("5");
      await following.getByLabel("Actions 2 Following action 1 partner facing", { exact: true }).selectOption("UP");
      const absent = actions.getByRole("group", { name: "Actions 2 Absent", exact: true });
      await add(absent, "Actions 2 Absent", "dialogue");
      await absent.getByLabel("Actions 2 Absent action 1 dialogue", { exact: true }).fill("Alone today.");
      await add(actions, "Actions", "walk-npc");
      await dialog.getByLabel("Actions Scene NPC", { exact: true }).selectOption(await page.evaluate(() => window.sceneActor));
      await dialog.getByLabel("Actions action 3 route", { exact: true }).fill("UP");
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/Scene checks passed/).waitFor();
      // Parking on the NPC route is reported at the affected walking action.
      await following.getByLabel("Actions 2 Following action 1 partner X", { exact: true }).fill("4");
      await following.getByLabel("Actions 2 Following action 1 partner Y", { exact: true }).fill("4");
      await dialog.getByRole("button", { name: "Check scene", exact: true }).click();
      await dialog.getByText(/NPC route reaches the partner's destination/).waitFor();
      await dialog.getByRole("button", { name: "Go to action", exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-scene-action") === "Action3");
      await following.getByLabel("Actions 2 Following action 1 partner X", { exact: true }).fill("3");
      await following.getByLabel("Actions 2 Following action 1 partner Y", { exact: true }).fill("5");
      await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      assert.equal(await following.getByLabel("Actions 2 Following action 1 partner X", { exact: true }).inputValue(), "3");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      try { await dialog.waitFor({ state: "hidden" }); } catch (error) { throw new Error((await dialog.getByRole("alert").allTextContents()).join("; ") || String(error)); }
      const saved = await page.evaluate(() => window.dialogueFiles["scripts/ViridianPokecenter.asm"]);
      assert.ok(saved.includes("call ApplyPikachuMovementData"));
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await following.getByLabel("Actions 2 Following action 1 partner X", { exact: true }).waitFor();
      assert.equal(await following.getByLabel("Actions 2 Following action 1 partner facing", { exact: true }).inputValue(), "UP");
      assert.equal(await absent.getByLabel("Actions 2 Absent action 1 dialogue", { exact: true }).inputValue(), "Alone today.");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: following/absent branches, partner destination, route conflict diagnostics, draft recovery and save/reopen verified`);
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
