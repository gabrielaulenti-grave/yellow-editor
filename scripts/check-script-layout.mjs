import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const directory = await mkdtemp(join("node_modules", ".script-layout-"));
let browser;
try {
  const outfile = join(directory, "fixture.mjs");
  await build({ entryPoints: ["tests/scriptLayoutFixture.tsx"], outfile, bundle: true,
    platform: "node", format: "esm", jsx: "automatic", packages: "external", loader: { ".css": "empty" } });
  const { flow, tab } = await import(pathToFileURL(outfile).href);
  const styles = (await Promise.all(["App.css", "ScriptsTab.css", "MapScriptPreview.css", "TextEditor.css"]
    .map((path) => readFile(join("src", path), "utf8")))).join("\n");
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${styles}\nbody{margin:0}#flow{margin:12px}</style>
    <main id="flow" class="editor-card">${flow}</main><div id="tab">${tab}</div>`);
  assert.equal(await page.locator("#flow .map-script-if-step").count(), 8);
  assert.equal(await page.getByText("Then", { exact: true }).count(), 8);
  assert.equal(await page.getByText("Otherwise", { exact: true }).count(), 8);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const widths = await page.locator("#flow .map-script-step-body")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    assert.ok(Math.min(...widths) >= Math.min(width - 120, 400), `${width}px: deep content narrowed to ${Math.min(...widths)}px`);
    if (width <= 430) assert.ok(Math.max(...widths) - Math.min(...widths) < 1, `${width}px: nesting still consumes width`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: page overflows horizontally`);
    const editor = await page.locator("#tab .script-browser").boundingBox();
    for (const selector of [".script-index-diagnostics", ".script-audit-panel"]) {
      const diagnostics = await page.locator(`#tab ${selector}`).boundingBox();
      assert.ok(diagnostics.y >= editor.y + editor.height, `${selector} appears before the workspace ends`);
    }
    console.log(`${width}px: eight nested conditions remain readable; diagnostics follow the workspace`);
  }
  // A desktop sidebar can constrain the editor even on a wide screen.
  await page.locator("#flow").evaluate((element) => { element.style.width = "400px"; });
  const widths = await page.locator("#flow .map-script-step-body")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  assert.ok(Math.min(...widths) > 250);
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1);
  console.log("400px desktop pane: nesting preserves the available width");
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
