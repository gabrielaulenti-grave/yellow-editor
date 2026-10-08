import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join("node_modules", ".npc-ui-"));
let browser;
try {
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/npcWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, plugins: [{ name: "fixture-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.npcInvoke(command, args);" }));
    } }] });
  const styles = (await Promise.all(["App.css", "MapNpcWizard.css", "TextEditor.css", "editor/SearchableSelect.css"].map(path => readFile(join("src", path), "utf8")))).join("\n");
  const script = await readFile(outfile, "utf8");
  browser = await chromium.launch();
  for (const width of [320, 375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
    await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Add NPC", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("X", { exact: true }).waitFor();
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), `${width}px: dialog overflows`);
    // Canvas has an accessible label; use it directly to exercise coordinate conversion.
    const preview = dialog.locator("canvas");
    await preview.click({ position: { x: 24, y: 40 } });
    assert.equal(await dialog.getByLabel("X", { exact: true }).inputValue(), "1");
    assert.equal(await dialog.getByLabel("Y", { exact: true }).inputValue(), "2");
    await dialog.getByRole("searchbox", { name: "Search Character" }).fill("character 29");
    assert.equal(await dialog.getByLabel("Character", { exact: true }).locator("option").count(), 2);
    await dialog.getByLabel("Character", { exact: true }).selectOption("SPRITE_CHARACTER_29");
    await dialog.getByLabel("Movement", { exact: true }).selectOption("WALK");
    await dialog.getByLabel("Wandering", { exact: true }).selectOption("LEFT_RIGHT");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByLabel("Line 1", { exact: true }).fill("This text is too long to fit");
    assert.equal(await dialog.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
    await dialog.getByLabel("Line 1", { exact: true }).fill("Hello there!");
    await dialog.getByRole("button", { name: "Add line", exact: true }).click();
    await dialog.getByLabel("Line 2", { exact: true }).fill("Welcome!");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    assert.ok(await dialog.getByText("Hello there!\nWelcome!", { exact: true }).count());
    await dialog.getByRole("button", { name: "Create NPC", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator(".world-map-npc-inspector").waitFor();
    const saved = await page.evaluate(() => window.npcSaves);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].values, { x: 1, y: 2, sprite: "SPRITE_CHARACTER_29", movement: "WALK", direction: "LEFT_RIGHT", dialogue: { kind: "new", lines: ["Hello there!", "Welcome!"] } });
    assert.ok(await page.evaluate(() => window.npcRefreshes >= 2));
    assert.ok(await page.locator(".world-map-npc-marker.selected").count());
    // Escape cancels an untouched new form without submitting another NPC.
    await page.getByRole("button", { name: "Add NPC", exact: true }).click();
    await page.getByRole("dialog").getByLabel("X", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.npcSaves.length), 1);
    console.log(`${width}px: NPC map placement, searchable sprites, movement, dialogue validation, save/refresh/selection, and Escape verified`);
    await page.close();
  }
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
