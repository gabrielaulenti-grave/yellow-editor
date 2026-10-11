import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const roots = process.argv.slice(2);
assert.ok(roots.length, "Supply pinned Red/Yellow source directories for the dialogue UI check.");
const directory = await mkdtemp(join("node_modules", ".dialogue-ui-"));
let browser;
try {
  const outfile = join(directory, "fixture.js");
  await build({ entryPoints: ["tests/scriptDialogueWorkflowFixture.tsx"], outfile, bundle: true, platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, plugins: [{ name: "fixture-session", setup(builder) {
      builder.onResolve({ filter: /platform\/compat$/ }, () => ({ path: "fixture-session", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const invoke = (command, args) => window.dialogueInvoke(command, args);" }));
    } }] });
  const styles = (await Promise.all(["App.css", "ScriptsTab.css", "MapScriptPreview.css", "TextEditor.css", "editor/SearchableSelect.css"]
    .map(path => readFile(join("src", path), "utf8")))).join("\n");
  const script = await readFile(outfile, "utf8");
  browser = await chromium.launch();
  for (const root of roots) {
    const original = {}, bytes = {};
    async function collect(folder = "") {
      for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await collect(path);
        else if (path.endsWith(".asm")) original[path] = await readFile(join(root, path), "utf8");
        else if (path.endsWith(".blk") || path.endsWith(".bst")) bytes[path] = Array.from(await readFile(join(root, path)));
      }
    }
    await collect();
    const objectPath = "data/maps/objects/ViridianCity.asm";
    original[objectPath] = original[objectPath].replace("ViridianCity_Object:", "\tconst_export VIRIDIANCITY_INTERACTION_TEST_NPC\n\nViridianCity_Object:").replace("def_warps_to VIRIDIAN_CITY", "\tobject_event 18, 19, SPRITE_YOUNGSTER, STAY, DOWN, TEXT_VIRIDIANCITY_INTERACTION_TEST_NPC\n\n\tdef_warps_to VIRIDIAN_CITY");
    original["scripts/ViridianCity.asm"] = original["scripts/ViridianCity.asm"].replace(/^(\s*dw_const ViridianCitySignText,)/m, "\tdw_const ViridianCityInteractionTestNpcText, TEXT_VIRIDIANCITY_INTERACTION_TEST_NPC\n$1") + "\nViridianCityInteractionTestNpcText:\n\ttext_far _ViridianCityYoungster1Text\n\ttext_end\n";
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"></div>`);
      await page.evaluate(({ files, bytes }) => { window.dialogueFiles = files; window.dialogueBytes = bytes; }, { files: original, bytes });
      await page.addScriptTag({ content: script });
      const preview = page.locator(".script-routine-details .text-editor-preview");
      await preview.filter({ hasText: "VIRIDIAN CITY" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Add action", exact: true }).count(), 0);
      assert.equal(await page.getByText(/No semantic operations are recognized/).count(), 0);
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit Dialogue" });
      await dialog.locator("textarea").first().waitFor();
      assert.equal(await dialog.locator("textarea").first().inputValue(), "VIRIDIAN CITY ");
      await dialog.locator("textarea").first().fill("WELCOME!");
      await page.waitForFunction(() => window.dialogueDirty === true);
      page.once("dialog", async confirmation => { await confirmation.dismiss(); });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await dialog.isVisible(), true, "Dirty text should survive a refused discard");
      await dialog.getByRole("button", { name: "Save text", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await preview.filter({ hasText: "WELCOME!" }).waitFor();
      const files = await page.evaluate(() => window.dialogueFiles);
      for (const [path, contents] of Object.entries(original)) {
        assert.equal(files[path], path === "text/ViridianCity.asm" ? contents.replace('text "VIRIDIAN CITY "', 'text "WELCOME!"') : contents,
          `${root} ${width}px: modified wrapper or neighbor source: ${path}`);
      }
      assert.equal(await page.evaluate(() => window.dialogueSaves.length), 1);
      await page.getByRole("button", { name: "Reload scripts", exact: true }).click();
      await preview.filter({ hasText: "WELCOME!" }).waitFor();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await dialog.locator("textarea").first().waitFor();
      assert.equal(await dialog.locator("textarea").first().inputValue(), "WELCOME!");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator(".script-group-list button").filter({ has: page.locator("strong").filter({ hasText: /^Route1$/ }) }).click();
      await page.getByRole("searchbox", { name: "Search routines in all companion files" }).fill("Route1Youngster1Text");
      await page.locator(".script-routine-list button").filter({ hasText: "Route1Youngster1Text" }).click();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await page.getByText("This interaction has 4 dialogue paths.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Add action", exact: true }).count(), 0);
      await page.getByRole("searchbox", { name: "Search dialogue paths" }).fill("Potion");
      assert.ok(await dialog.locator(".text-editor-path-list button").count());
      await dialog.locator(".text-editor-path-list button").first().click();
      await dialog.locator("textarea").first().fill("Thank you!");
      await dialog.getByRole("button", { name: "Save text", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      const interaction = page.getByRole("dialog", { name: "Edit interaction", exact: true });
      await interaction.getByRole("spinbutton", { name: "Reward quantity" }).fill("2");
      await interaction.getByRole("checkbox", { name: "Allow another attempt when the bag is full" }).check();
      await interaction.getByRole("button", { name: "Save reward", exact: true }).click();
      await interaction.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await interaction.getByRole("spinbutton", { name: "Reward quantity" }).inputValue(), "2");
      assert.equal(await interaction.getByRole("checkbox", { name: "Allow another attempt when the bag is full" }).count(), 0);
      await interaction.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Reload scripts", exact: true }).click();
      await preview.filter({ hasText: "WELCOME!" }).waitFor();
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      await interaction.getByRole("checkbox", { name: "Give an item", exact: true }).check();
      await interaction.getByRole("spinbutton", { name: "Reward quantity" }).fill("3");
      await interaction.getByRole("textbox", { name: "Interaction dialogue" }).fill("<PLAYER> received\na MOON STONE!");
      await interaction.getByRole("button", { name: "Save interaction", exact: true }).click();
      await interaction.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await interaction.getByRole("spinbutton", { name: "Reward quantity" }).inputValue(), "3");
      assert.equal(await interaction.getByRole("textbox", { name: "Interaction dialogue" }).inputValue(), "<PLAYER> received\na MOON STONE!");
      await interaction.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search dialogue paths" }).fill("received");
      await dialog.locator(".text-editor-path-list button").first().click();
      await dialog.getByRole("button", { name: "Add text line", exact: true }).click();
      await dialog.locator("textarea").nth(2).fill("Enjoy!");
      await dialog.getByRole("combobox", { name: "Text flow control", exact: true }).nth(2).selectOption("para");
      await dialog.getByRole("button", { name: "Save text", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await interaction.getByRole("textbox", { name: "Interaction dialogue" }).inputValue(), "<PLAYER> received\na MOON STONE!\nEnjoy!");
      await interaction.getByRole("checkbox", { name: "Have an NPC approach", exact: true }).check();
      await interaction.getByRole("combobox", { name: "Approaching NPC" }).selectOption("VIRIDIANCITY_INTERACTION_TEST_NPC");
      await interaction.getByRole("textbox", { name: "NPC walking route" }).fill("UP");
      await interaction.getByRole("button", { name: "Save interaction", exact: true }).click();
      await interaction.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit interaction", exact: true }).click();
      assert.equal(await interaction.getByRole("textbox", { name: "NPC walking route" }).inputValue(), "UP");
      const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflowing, false, "Interaction form must fit the viewport");
      assert.deepEqual(errors, []);
      await interaction.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search dialogue paths" }).fill("received");
      await dialog.locator(".text-editor-path-list button").first().click();
      assert.equal(await dialog.getByRole("combobox", { name: "Text flow control", exact: true }).nth(2).inputValue(), "para");
      console.log(`${root} ${width}px: Scripts-tab sign edit/save/reload, byte preservation, dirty protection, and NPC branch picker passed`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
