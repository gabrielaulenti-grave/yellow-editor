import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-interactions-"));
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
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Viridian City$/ }).waitFor();
      await page.locator(".world-map-npc-list button").first().click();
      let inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit text", exact: true }).click();
      const textDialog = page.getByRole("dialog", { name: "Edit NPC dialogue", exact: true });
      await textDialog.locator("textarea").first().fill("Hello, <PLAYER>!");
      await page.waitForFunction(() => window.dialogueDirty === true);
      await textDialog.getByRole("button", { name: "Save text", exact: true }).click();
      await textDialog.waitFor({ state: "hidden" });
      const edit = inspector.getByRole("button", { name: "Edit interaction", exact: true });
      await edit.click();
      const dialog = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await dialog.getByRole("button", { name: "Compose action sequence", exact: true }).click();
      await page.waitForFunction(() => window.dialogueDirty === true);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await edit.click();
      await dialog.getByRole("button", { name: "Resume draft", exact: true }).click();
      await dialog.getByRole("group", { name: "Actions", exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      inspector = page.locator(".world-map-npc-inspector");
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("group", { name: "Actions", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.dialogueDirty), false);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const targets = await page.evaluate(() => window.interactionTargets);
      assert.ok(targets.every(target => target.path === "scripts/ViridianCity.asm" && target.label === "ViridianCityYoungster1Text"), "Interaction must use the original entry, including forwarded Yellow dialogue");
      await inspector.getByRole("button", { name: "View script", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.openedScript), { path: "scripts/ViridianCity.asm", label: "ViridianCityYoungster1Text" });
      await page.locator(".world-map-npc-list button").nth(1).click();
      await inspector.getByText(/New actions require a plain dialogue entry/).waitFor();
      assert.equal(await inspector.getByRole("button", { name: "Edit interaction", exact: true }).isDisabled(), true);
      await inspector.getByRole("button", { name: "View script", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.openedScript), { path: "scripts/ViridianCity.asm", label: "ViridianCityGambler1Text" });
      await page.locator(".world-map-sign-list button").first().click();
      inspector = page.locator(".world-map-sign-inspector");
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Interaction dialogue", exact: true }).fill("Welcome, <PLAYER>!");
      await dialog.getByRole("button", { name: "Save interaction", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await inspector.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await dialog.getByRole("textbox", { name: "Interaction dialogue", exact: true }).inputValue(), "Welcome, <PLAYER>!");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Map composer must fit viewport");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await inspector.getByRole("button", { name: "View script", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.openedScript), { path: "scripts/ViridianCity.asm", label: "ViridianCitySignText" });
      assert.equal(await page.evaluate(() => window.dialogueSaves.length), 3);
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: map NPC/sign composition, original entry routing, unsupported fallback, draft recovery, save/reopen and selection verified`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
