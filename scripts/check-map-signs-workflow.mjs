import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2), directory = await mkdtemp(join("node_modules", ".map-sign-ui-"));
const server = createServer((_req, res) => res.end('<!doctype html><div id="root"></div>')); let browser;
try {
  assert.ok(roots.length, "Supply Red/Yellow source directories.");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "session", setup(b) {
    b.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "session", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
  } }] });
  const script = await readFile(outfile, "utf8"), styles = (await Promise.all(["App.css", "MapNpcWizard.css", "MapScriptPreview.css", "MapEditing.css", "TextEditor.css", "editor/SearchableSelect.css"].map(p => readFile(join("src", p), "utf8")))).join("\n");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined });
  for (const root of roots) {
    const files = {}, bytes = {};
    async function collect(p = "") { for (const e of await readdir(join(root, p), { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const path = join(p, e.name); if (e.isDirectory()) await collect(path); else if (path.endsWith(".asm")) files[path] = await readFile(join(root, path), "utf8"); else if (path.endsWith(".blk") || path.endsWith(".bst") || /^gfx\/tilesets\/.*\.png$/.test(path)) bytes[path] = Array.from(await readFile(join(root, path))); } }
    await collect();
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: width < 700 ? "dark" : "light" }), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.getByRole("button", { name: "Place sign", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: /^Place sign in/ });
      await dialog.getByLabel("Sign X", { exact: true }).fill("17"); await dialog.getByLabel("Sign Y", { exact: true }).fill("16");
      await dialog.getByLabel("New sign dialogue", { exact: true }).fill("New trail!\nEnjoy!");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save sign", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Sign 5 at 17, 16", exact: true }).waitFor(); assert.equal(await page.locator(".world-map-sign-list > button").count(), 5);
      await page.getByRole("button", { name: "Edit sign", exact: true }).click(); dialog = page.getByRole("dialog", { name: /^Edit sign #5/ });
      await dialog.getByLabel("Sign X", { exact: true }).fill("16");
      await dialog.getByRole("button", { name: "Edit text", exact: true }).click();
      const text = page.getByRole("dialog", { name: "Edit Sign dialogue", exact: true }); await text.locator("input[type=text], textarea").first().fill("Welcome!");
      await text.getByRole("button", { name: "Apply text", exact: true }).click(); await text.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole("button", { name: "Save sign", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Sign 5 at 16, 16", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"].includes('text "Welcome!"')));
      const pointerSource = await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]);
      await page.getByRole("button", { name: "Review sign removal", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Review removal", exact: true });
      assert.equal(await dialog.getByRole("button", { name: "Remove record", exact: true }).isDisabled(), true);
      await dialog.getByRole("checkbox", { name: /^Remove this record/ }).check(); await dialog.getByRole("button", { name: "Remove record", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.querySelectorAll(".world-map-sign-list > button").length === 4);
      assert.equal(await page.evaluate(() => window.dialogueFiles["scripts/PalletTown.asm"]), pointerSource);
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed")); });
      await page.getByRole("button", { name: "Sign 5 at 16, 16", exact: true }).waitFor();
      await page.locator(".world-map-list").getByRole("button", { name: /^Pewter Speech House/ }).click();
      await page.locator(".world-map-npc-list > button").nth(0).click(); await page.getByRole("button", { name: "Review object removal", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Review removal", exact: true });
      await dialog.getByRole("heading", { name: "Removal needs source review", exact: true }).waitFor(); assert.equal(await dialog.getByRole("button", { name: "Remove record", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Close removal review", exact: true }).click();
      await page.locator(".world-map-npc-list > button").nth(1).click(); await page.getByRole("button", { name: "Review object removal", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Review removal", exact: true });
      await dialog.getByRole("checkbox", { name: /^Remove this record/ }).check(); await dialog.getByRole("button", { name: "Remove record", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.querySelectorAll(".world-map-npc-list > button").length === 1);
      if (width === 1280) {
        await page.evaluate(() => { window.dialogueFiles["data/maps/headers/Route1.asm"] = "custom_header\n"; });
        await page.getByRole("button", { name: "Check project maps", exact: true }).click(); const report = page.getByRole("region", { name: "Project map check results", exact: true }); await report.waitFor({ timeout: 120000 });
        const route = report.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Route 1 ·/ }) }); await route.locator("summary").click(); await route.getByRole("button", { name: "View source", exact: true }).first().click();
        assert.equal(await page.evaluate(() => window.openedScript.path), "data/maps/headers/Route1.asm");
        await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new CustomEvent("yellow-editor:history-changed")); }); await report.waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []); await page.close(); console.log(`${root}: signs, removal review, stable pointers and undo passed at ${width}px`);
    }
  }
} finally { await browser?.close(); server.close(); await rm(directory, { recursive: true, force: true }); }
