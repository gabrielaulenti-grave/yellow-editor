import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const temporary = await mkdtemp(join("node_modules", ".move-edit-ui-"));
const server = createServer((_request, response) => response.end('<!doctype html><div id="root"></div>'));
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const outfile = join(temporary, "fixture.js");
  await build({ entryPoints: ["tests/graphicsWorkflowFixture.tsx"], outfile, bundle: true, format: "esm", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env.BASE_URL": '"/"', "import.meta.env.VITE_RELEASE_CHANNEL": '"test"' }, plugins: [{ name: "graphics-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const invoke = (command,args) => window.graphicsInvoke(command,args); export const convertFileSrc = path => path; export const open = async () => "graphics-fixture"; export const saveProjectCopy = async () => null;' }));
    } }] });
  const script = await readFile(outfile, "utf8");
  const styles = (await Promise.all(["App.css", "Editing.css", "GraphicsTab.css", "BattleAnimationsPanel.css", "ContentCreateDialog.css", "editor/SearchableSelect.css"].map(path => readFile(join("src", path), "utf8")))).join("\n");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined });
  for (const root of roots) {
    const bytes = {};
    async function collect(folder = "") {
      for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collect(path);
        else if (/\.(asm|inc|png|blk|bst|1bpp|2bpp|pic)$/.test(path) || ["Makefile", "layout.link"].includes(path)) bytes[path] = Array.from(await readFile(join(root, path)));
      }
    }
    await collect();
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.setDefaultTimeout(30000); page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(bytes => { window.graphicsBytes = structuredClone(bytes); window.graphicsKey = `content-${Date.now()}`; window.graphicsApp = true; }, bytes);
      await page.addScriptTag({ type: "module", content: script });
      await page.getByRole("button", { name: "Open Project", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".project-strip") && !Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Open Project").disabled);
      await page.getByRole("button", { name: "Moves", exact: true }).click();
      const input = label => page.getByLabel(label, { exact: true });
      const button = name => page.locator(".edit-toolbar").getByRole("button", { name, exact: true });
      const fill = async () => {
        await input("Move name").fill("SOLAR PUNCH"); await input("Move power").fill("90");
        await input("Move accuracy").fill("95"); await input("Move pp").fill("15");
        await input("Move type").selectOption("FIRE"); await input("Move battle behavior").selectOption("BURN_SIDE_EFFECT1");
      };
      await input("Move name").waitFor();
      await fill();
      assert.equal(await button("Undo").isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "New move", exact: true }).isDisabled(), true);
      await input("Move pp").fill("41"); assert.equal(await button("Save").isDisabled(), true);
      await page.getByRole("alert").filter({ hasText: "PP must" }).waitFor(); await input("Move pp").fill("15");
      assert.equal(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
      page.once("dialog", dialog => dialog.dismiss()); await page.locator(".move-list button").nth(1).click();
      assert.equal(await input("Move name").inputValue(), "SOLAR PUNCH");
      page.once("dialog", dialog => dialog.accept()); await page.locator(".move-list button").nth(1).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "KARATE CHOP");
      await page.locator(".move-list button").first().click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "POUND");
      await fill(); await input("Move pp").press("Control+s");
      await page.waitForFunction(() => !document.querySelector(".unsaved-indicator") && document.querySelector(".move-list button").textContent.includes("SOLAR PUNCH"));
      let saved = (await page.evaluate(() => window.graphicsInvoke("get_moves")))[0];
      assert.equal(saved.power, 90); assert.equal(saved.moveType, "FIRE"); assert.equal(saved.effect, "BURN_SIDE_EFFECT1"); assert.equal(saved.animation, "POUND");
      await button("Undo").click(); await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "POUND");
      await button("Redo").click(); await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "SOLAR PUNCH");
      await input("Move power").fill("99"); await button("Revert").click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move power"]')?.value === "90");
      await input("Move name").fill("UNSAVED");
      page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Open Project", exact: true }).click();
      assert.equal(await input("Move name").inputValue(), "UNSAVED");
      page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Inspect move animation in Graphics", exact: true }).click();
      assert.equal(await input("Move name").inputValue(), "UNSAVED");
      page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Items", exact: true }).click();
      await page.getByRole("button", { name: "Moves", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "SOLAR PUNCH");
      await page.getByRole("button", { name: "New move", exact: true }).click();
      const form = page.getByRole("dialog", { name: "New move", exact: true });
      await form.getByLabel("New content name", { exact: true }).fill("NEW STRIKE");
      await form.getByRole("button", { name: "Create move", exact: true }).click(); await form.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "NEW STRIKE");
      const animationBefore = await page.evaluate(() => window.graphicsBytes["data/moves/animations.asm"].slice());
      await input("Move name").fill("NEW TACKLE"); await input("Move power").fill("75"); await button("Save").click();
      await page.waitForFunction(() => !document.querySelector(".unsaved-indicator"));
      saved = (await page.evaluate(() => window.graphicsInvoke("get_moves")))[165]; assert.equal(saved.name, "NEW TACKLE"); assert.equal(saved.power, 75);
      assert.deepEqual(await page.evaluate(() => window.graphicsBytes["data/moves/animations.asm"]), animationBefore);
      await input("Move power").fill("85");
      await page.evaluate(() => { const p = "data/moves/names.asm", text = new TextDecoder().decode(Uint8Array.from(window.graphicsBytes[p])); window.graphicsBytes[p] = Array.from(new TextEncoder().encode(text.replace('li "NEW TACKLE"', 'li "EXTERNAL"'))); });
      await button("Save").click(); await page.getByRole("alert").filter({ hasText: "sources changed" }).waitFor();
      assert.equal(await input("Move power").inputValue(), "85");
      page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Reload move sources", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "EXTERNAL");
      assert.equal(await input("Move power").inputValue(), "75");
      await page.locator(".move-list button").first().click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Move name"]')?.value === "SOLAR PUNCH");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.MOVE_SCREENSHOT && width === 1280) await page.screenshot({ path: process.env.MOVE_SCREENSHOT, fullPage: true });
      assert.deepEqual(errors, []);
      console.log(`${root}: ${width}px move edits, validation, keyboard save, undo/redo, navigation guards and stale-source reload passed.`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
