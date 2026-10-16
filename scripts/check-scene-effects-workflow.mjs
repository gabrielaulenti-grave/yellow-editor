import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".scene-effects-workflow-"));
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
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.sceneFixture = true; window.mapFocus = "VIRIDIAN_POKECENTER"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /Viridian/i }).waitFor();
      await page.locator(".world-map-npc-list button").last().click();
      const inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      const actions = dialog.getByRole("group", { name: "Actions", exact: true });
      await actions.getByLabel("Actions action 1 dialogue", { exact: true }).fill("A challenger appears!");
      async function add(kind) {
        await actions.getByLabel("Actions action type", { exact: true }).selectOption(kind);
        await actions.getByRole("button", { name: "Actions add action", exact: true }).click();
      }
      await add("music");
      const track = root.includes("pokeyellow") ? "MUSIC_MEET_JESSIE_JAMES" : "MUSIC_MEET_PROF_OAK";
      await actions.getByLabel("Actions Music track", { exact: true }).selectOption(track);
      await actions.getByLabel("Keep music after normal scene completion", { exact: true }).check();
      await add("wild-battle");
      await actions.getByLabel("Actions Encounter Pokémon", { exact: true }).selectOption("MEWTWO");
      await actions.getByLabel("Actions Encounter level", { exact: true }).fill("70");
      const caught = actions.getByRole("group", { name: "Actions 3 Caught", exact: true });
      await caught.getByLabel("Actions 3 Caught action type", { exact: true }).selectOption("dialogue");
      await caught.getByRole("button", { name: "Actions 3 Caught add action", exact: true }).click();
      await caught.getByLabel("Actions 3 Caught action 1 dialogue", { exact: true }).fill("You caught it!");
      await add("trainer-battle");
      await actions.getByLabel("Actions action 4 trainer party", { exact: true }).selectOption("YOUNGSTER:1");
      await add("fade");
      await add("visibility");
      await actions.getByLabel("Actions Scene NPC", { exact: true }).selectOption(await page.evaluate(() => window.sceneActor));
      await actions.getByLabel("Visible (uncheck to hide)", { exact: true }).uncheck();
      await add("wait");
      await actions.getByLabel("Actions Wait frames", { exact: true }).fill("3");
      await add("fade");
      await actions.getByLabel("Actions action 8 screen effect", { exact: true }).selectOption("in");
      await add("music");
      await actions.getByLabel("Actions action 9 music operation", { exact: true }).selectOption("restore");
      await dialog.getByLabel("Scene trigger", { exact: true }).selectOption("coordinate");
      await dialog.getByLabel("Scene player X", { exact: true }).fill("4");
      await dialog.getByLabel("Scene player Y", { exact: true }).fill("7");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const saved = await page.evaluate(() => window.dialogueSaves);
      assert.equal(saved.length, 1, "Actions, runtime, texts and checkpoint flags save atomically");
      const generated = saved[0].find(write => write.path === "scripts/ViridianPokecenter.asm").contents;
      const metadata = JSON.parse(generated.match(/yellow-editor-interaction: (.*)/)[1]);
      assert.equal(metadata.values.actions[1].track, track);
      assert.equal(metadata.values.actions[1].persist, true);
      assert.equal(metadata.values.actions[2].species, "MEWTWO");
      assert.equal(metadata.values.actions[2].level, 70);
      assert.equal(metadata.values.actions[2].caught[0].lines[0], "You caught it!");
      assert.equal(metadata.values.actions[3].trainer, "YOUNGSTER:1");
      assert.equal(metadata.values.actions[4].mode, "out");
      assert.equal(metadata.values.actions[7].mode, "in");
      assert.ok(metadata.values.actions[2].battleId !== metadata.values.actions[3].battleId);
      assert.ok(generated.includes("call GBFadeOutToBlack"));
      assert.ok(saved[0].some(write => write.path === "ram/wram.asm" && write.contents.includes("scene-scratch: 2")));
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await dialog.getByLabel("Actions Encounter level", { exact: true }).inputValue(), "70");
      assert.equal(await dialog.getByLabel("Actions 3 Caught action 1 dialogue", { exact: true }).inputValue(), "You caught it!");
      assert.equal(await dialog.getByLabel("Actions action 4 trainer party", { exact: true }).inputValue(), "YOUNGSTER:1");
      assert.equal(await dialog.getByLabel("Actions action 8 screen effect", { exact: true }).inputValue(), "in");
      assert.equal(await page.evaluate(() => window.dialogueDirty), false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: music, wild/trainer result branches, Giovanni fade sequence, atomic save/reopen and layout verified`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
