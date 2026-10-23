import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const directory = await mkdtemp(join("node_modules", ".map-edit-ui-"));
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
      const mobile = width < 700;
      const page = await browser.newPage({ viewport: { width, height: mobile ? 700 : 900 }, hasTouch: mobile, isMobile: mobile }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; window.mapSurface = true; window.mapFocus = "PALLET_TOWN"; }, { files, bytes });
      await page.addScriptTag({ content: script });
      await page.locator(".world-map-title h3").filter({ hasText: /^Pallet Town$/ }).waitFor();
      await page.getByRole("button", { name: "Edit terrain", exact: true }).click();
      let terrain = page.getByRole("dialog", { name: /Edit terrain/ });
      await terrain.getByLabel("Selected block", { exact: true }).waitFor();
      const layout = bytes["maps/PalletTown.blk"].slice();
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      if (mobile) {
        const viewport = terrain.getByRole("region", { name: "Paint map blocks viewport", exact: true });
        const canvas = terrain.getByLabel("Paint map blocks", { exact: true });
        const session = await page.context().newCDPSession(page);
        async function swipe(target, xDistance, yDistance) {
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
          for (let step = 1; step <= 12; step++) {
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + xDistance * step / 12, y: y + yDistance * step / 12, id: 0 }] });
            await page.evaluate(() => new Promise(requestAnimationFrame));
          }
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          console.log("Touch viewport", await target.evaluate(view => {
            const box = view.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
            return { name: view.getAttribute("aria-label"), left: view.scrollLeft, top: view.scrollTop, width: view.clientWidth, height: view.clientHeight, fullWidth: view.scrollWidth, fullHeight: view.scrollHeight, touchAction: getComputedStyle(view.querySelector("canvas")).touchAction, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200) };
          }));
        }
        await terrain.getByLabel("Map tool", { exact: true }).selectOption("scroll");
        await terrain.getByLabel("Map zoom", { exact: true }).selectOption("3");
        await swipe(viewport, -100, 0);
        await swipe(viewport, 0, -140);
        await page.waitForFunction(() => {
          const view = document.querySelector('[aria-label="Paint map blocks viewport"]');
          return view.scrollLeft > 0 && view.scrollTop > 0;
        });
        assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
        assert.equal(await terrain.getByRole("button", { name: "Undo stroke", exact: true }).isDisabled(), true);
        await terrain.getByLabel("Map tool", { exact: true }).selectOption("paint");
        await viewport.scrollIntoViewIfNeeded();
        const at = await viewport.evaluate(view => {
          const box = view.getBoundingClientRect(), canvas = view.querySelector("canvas").getBoundingClientRect();
          return { x: Math.floor((box.left + box.width / 2 - canvas.left) / 96), y: Math.floor((box.top + box.height / 2 - canvas.top) / 96) };
        });
        const selected = (layout[at.y * 10 + at.x] + 1) % await terrain.getByLabel("Selected block", { exact: true }).locator("option").count();
        await terrain.getByLabel("Selected block", { exact: true }).selectOption(String(selected));
        await viewport.scrollIntoViewIfNeeded();
        const box = await viewport.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), false);
        await terrain.getByRole("button", { name: "Undo stroke", exact: true }).click();
        assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
        await terrain.getByLabel("Map zoom", { exact: true }).selectOption("1");
        await viewport.evaluate(view => view.scrollTo(0, 0));
        const palette = terrain.getByRole("region", { name: "Choose map block viewport", exact: true });
        const before = await terrain.getByLabel("Selected block", { exact: true }).inputValue();
        await swipe(palette, 0, -100);
        await page.waitForFunction(() => document.querySelector('[aria-label="Choose map block viewport"]').scrollTop > 0);
        assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), before);
        const chosen = await palette.evaluate(view => {
          const box = view.getBoundingClientRect(), canvas = view.querySelector("canvas").getBoundingClientRect();
          return Math.floor((box.top + box.height / 2 - canvas.top) / 32) * 8 + Math.floor((box.left + box.width / 2 - canvas.left) / 32);
        });
        const paletteBox = await palette.boundingBox();
        await page.touchscreen.tap(paletteBox.x + paletteBox.width / 2, paletteBox.y + paletteBox.height / 2);
        assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), String(chosen));
        await session.detach();
        assert.equal(await canvas.evaluate(element => getComputedStyle(element).touchAction), "none");
      }
      await terrain.getByLabel("Map tool", { exact: true }).selectOption("pick");
      await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: 2 * 32 + 16, y: 32 + 16 } });
      assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), String(layout[12]));
      await terrain.getByLabel("Map tool", { exact: true }).selectOption("paint");
      await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: 48, y: 176 } });
      await terrain.getByRole("button", { name: "Undo stroke", exact: true }).click();
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      await terrain.getByRole("button", { name: "Redo stroke", exact: true }).click();
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        await terrain.getByLabel("Selected block", { exact: true }).selectOption(String(layout[(1 + y) * 10 + 2 + x]));
        await terrain.getByLabel("Paint map blocks", { exact: true }).click({ position: { x: (1 + x) * 32 + 16, y: (5 + y) * 32 + 16 } });
        layout[(5 + y) * 10 + 1 + x] = bytes["maps/PalletTown.blk"][(1 + y) * 10 + 2 + x];
      }
      await page.waitForFunction(() => window.dialogueDirty);
      page.once("dialog", confirm => confirm.dismiss()); await terrain.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await terrain.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.MAP_EDIT_SCREENSHOT && width === 1280) await page.screenshot({ path: process.env.MAP_EDIT_SCREENSHOT });
      await terrain.getByRole("button", { name: "Save terrain", exact: true }).click(); await terrain.waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => window.dialogueBytes["maps/PalletTown.blk"]), layout);
      await page.evaluate(async () => { await window.dialogueInvoke("undo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });
      assert.deepEqual(await page.evaluate(() => window.dialogueBytes["maps/PalletTown.blk"]), bytes["maps/PalletTown.blk"]);
      await page.evaluate(async () => { await window.dialogueInvoke("redo_map_fixture"); window.dispatchEvent(new Event("yellow-editor:history-changed")); });

      await page.getByRole("button", { name: "Edit terrain", exact: true }).click(); terrain = page.getByRole("dialog", { name: /Edit terrain/ });
      await terrain.locator("summary").click();
      const oldBlockset = bytes["gfx/blocksets/overworld.bst"], newId = oldBlockset.length / 16;
      await terrain.getByRole("button", { name: "Duplicate selected block", exact: true }).click();
      assert.equal(await terrain.getByLabel("Selected block", { exact: true }).inputValue(), String(newId));
      await terrain.getByLabel("Selected tile", { exact: true }).selectOption(oldBlockset[0] === 0 ? "1" : "0");
      await terrain.getByLabel("Paint tiles inside block", { exact: true }).click({ position: { x: 24, y: 24 } });
      assert.equal(await terrain.getByRole("button", { name: "Save terrain", exact: true }).isDisabled(), true);
      await terrain.getByLabel("I understand that blockset changes are shared by all maps using this blockset.", { exact: true }).check();
      await terrain.getByRole("button", { name: "Save terrain", exact: true }).click(); await terrain.waitFor({ state: "hidden" });
      const editedBlocks = await page.evaluate(() => window.dialogueBytes["gfx/blocksets/overworld.bst"]);
      assert.deepEqual(editedBlocks.slice(0, oldBlockset.length), oldBlockset);
      assert.equal(editedBlocks.length, oldBlockset.length + 16);

      await page.getByRole("button", { name: "Add warp", exact: true }).click();
      const warpDialog = page.getByRole("dialog", { name: /Add warp/ });
      await warpDialog.getByLabel("Warp X", { exact: true }).fill("3"); await warpDialog.getByLabel("Warp Y", { exact: true }).fill("13");
      await warpDialog.getByLabel("Destination map", { exact: true }).selectOption("BLUES_HOUSE");
      await warpDialog.getByLabel("Create a new return warp in the destination", { exact: true }).check();
      await warpDialog.getByLabel("Place return warp", { exact: true }).click({ position: { x: 88, y: 88 } });
      assert.equal(await warpDialog.getByLabel("Return warp X", { exact: true }).inputValue(), "5");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await warpDialog.getByRole("button", { name: "Save entrance and return", exact: true }).click(); await warpDialog.waitFor({ state: "hidden" });
      const pair = await page.evaluate(() => window.dialogueSaves.at(-1)); assert.equal(pair.length, 2);
      assert.match(pair[0].contents, /warp_event 3, 13, BLUES_HOUSE, 3/); assert.match(pair[1].contents, /warp_event 5, 5, PALLET_TOWN, 4/);
      await page.locator(".world-map-warp-list button").last().click();
      await page.getByRole("button", { name: "Edit selected warp", exact: true }).click();
      const editWarp = page.getByRole("dialog", { name: /Edit warp #4/ });
      await editWarp.getByLabel("Warp X", { exact: true }).fill("-1");
      await editWarp.getByRole("button", { name: "Save warp", exact: true }).click();
      await editWarp.getByRole("alert").filter({ hasText: /Warp X/ }).waitFor();
      await editWarp.getByLabel("Warp X", { exact: true }).fill("4");
      await editWarp.getByRole("button", { name: "Save warp", exact: true }).click(); await editWarp.waitFor({ state: "hidden" });
      await page.locator(".world-map-warp-list button").last().click();
      await page.locator(".world-map-warp-inspector").getByRole("button", { name: /^Go to / }).click();
      await page.locator(".world-map-title h3").filter({ hasText: /^Blues House$/ }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`${root} ${width}px: house painting, stroke undo/redo, custom block tiles, binary history, paired warp creation, validation, editing and navigation passed`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
