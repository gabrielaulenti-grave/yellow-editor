import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply Red/Yellow source directories.");
const temporary = await mkdtemp(join("node_modules", ".content-ui-"));
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
  const styles = (await Promise.all(["App.css", "GraphicsTab.css", "BattleAnimationsPanel.css", "ContentCreateDialog.css", "editor/SearchableSelect.css"].map(path => readFile(join("src", path), "utf8")))).join("\n");
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
      await page.getByRole("button", { name: "New move", exact: true }).click();
      let form = page.getByRole("dialog", { name: "New move", exact: true });
      await form.getByLabel("New content name", { exact: true }).fill("EDITOR SPARK");
      await form.getByLabel("New content constant", { exact: true }).fill("EDITOR_SPARK");
      await form.getByLabel("Move template", { exact: true }).selectOption("84");
      await form.getByLabel("New move behavior", { exact: true }).selectOption("NO_ADDITIONAL_EFFECT");
      await form.getByLabel("New move power", { exact: true }).fill("65");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await form.getByRole("button", { name: "Create move", exact: true }).click();
      await form.waitFor({ state: "detached" });
      assert.equal((await page.evaluate(() => window.graphicsInvoke("get_moves")))[165].constant, "EDITOR_SPARK");
      await page.getByRole("button", { name: "Pokémon", exact: true }).click();
      await page.getByRole("button", { name: "New Pokémon", exact: true }).click();
      form = page.getByRole("dialog", { name: "New Pokémon", exact: true });
      await form.getByLabel("New content name", { exact: true }).fill("EDITORMON");
      await form.getByLabel("New content constant", { exact: true }).fill("EDITOR_MON");
      await form.getByLabel("Pokémon template", { exact: true }).selectOption("153");
      await form.getByLabel("New Pokémon starting move", { exact: true }).selectOption("EDITOR_SPARK");
      await form.getByLabel("New Pokémon category", { exact: true }).fill("TEST");
      if (process.env.CONTENT_SCREENSHOT && width === 1280) await page.screenshot({ path: process.env.CONTENT_SCREENSHOT, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await form.getByRole("button", { name: "Create Pokémon", exact: true }).click();
      await form.waitFor({ state: "detached" });
      assert.equal((await page.evaluate(() => window.graphicsInvoke("get_pokemon_index"))).find(mon => mon.internalId === 191).constant, "EDITOR_MON");
      await page.getByRole("button", { name: "Trainers", exact: true }).click();
      await page.getByRole("button", { name: "New trainer party", exact: true }).click();
      form = page.getByRole("dialog", { name: "New trainer party", exact: true });
      await form.getByLabel("New party class", { exact: true }).selectOption("YOUNGSTER");
      await form.getByLabel("New party Pokémon 1", { exact: true }).selectOption("EDITOR_MON");
      await form.getByLabel("New party level 1", { exact: true }).fill("7");
      await form.getByRole("button", { name: "Add party Pokémon", exact: true }).click();
      await form.getByLabel("New party level format", { exact: true }).selectOption("individual-levels");
      await form.getByLabel("New party level 2", { exact: true }).fill("12");
      await form.getByRole("button", { name: "Create trainer party", exact: true }).click();
      await form.waitFor({ state: "detached" });
      const catalog = await page.evaluate(() => window.graphicsInvoke("get_trainers"));
      assert.ok(catalog.trainers.some(party => party.pokemon.some(mon => mon.speciesConstant === "EDITOR_MON") && party.pokemon.length === 2));
      // External source changes must leave the form open with an actionable error.
      await page.getByRole("button", { name: "Moves", exact: true }).click();
      await page.getByRole("button", { name: "New move", exact: true }).click();
      form = page.getByRole("dialog", { name: "New move", exact: true });
      await form.getByLabel("New content name", { exact: true }).fill("STALE MOVE");
      await page.evaluate(() => window.graphicsBytes["data/moves/moves.asm"].push(...new TextEncoder().encode("\n; outside edit\n")));
      await form.getByRole("button", { name: "Create move", exact: true }).click();
      await form.getByRole("alert").filter({ hasText: "sources changed" }).waitFor();
      page.once("dialog", dialog => dialog.accept());
      await form.getByRole("button", { name: "Close creation form", exact: true }).click();
      await form.waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      console.log(`${root}: ${width}px new move, additional species, independent trainer party, live refresh and stale-source refusal passed.`);
      await page.close();
    }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
