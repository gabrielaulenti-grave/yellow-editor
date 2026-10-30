import { loadGraphicsCatalog, loadGraphicsDocument } from "./graphics";
import { encodeGraphicsPng } from "./graphicsPixels";
import { bytesToHex, hashText } from "./history";
import { readProjectRgbdsSources } from "./projectConstants";
import type { ProjectSource, TextWriteRequest } from "./types";

/** Keep the bank-relative portrait table valid by placing all trainer pictures as one section. */
export async function prepareTrainerPortraitCopy(source: ProjectSource, constant: string, templateLabel: string): Promise<{ label: string; changes: TextWriteRequest[] }> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(constant)) throw new Error("Invalid trainer class constant for portrait creation.");
  const catalog = await loadGraphicsCatalog(source);
  const candidates = catalog.assets.filter(asset => asset.references.some(ref => ref.labels.includes(templateLabel)));
  if (candidates.length !== 1) throw new Error("The portrait template must resolve to one source graphic.");
  const asset = candidates[0], reference = asset.references.find(ref => ref.labels.includes(templateLabel));
  if (asset.reason || !reference || reference.slice || !reference.target.endsWith(".pic")) throw new Error("This portrait source cannot yet be copied independently. Choose a portrait with a complete compressed-picture include.");
  const path = `gfx/trainers/${constant.toLowerCase()}.png`, label = `YellowEditor_${constant}_Pic`;
  if ((await Promise.all(["png", "pic", "2bpp", "1bpp"].map(extension => source.exists(path.replace(/\.png$/, `.${extension}`))))).some(Boolean)) throw new Error(`Portrait ${path} already exists; choose a unique class constant.`);
  const files = await readProjectRgbdsSources(source);
  if (files.some(file => file.readError)) throw new Error("All assembly sources must be readable to check the new portrait label.");
  if (files.some(file => new RegExp(`\\b${label}\\b`).test(file.contents))) throw new Error(`Portrait label ${label} already exists.`);
  const text = files.find(file => file.path === reference.path)?.contents;
  if (text === undefined) throw new Error("The portrait include source is unavailable.");
  const lines = text.split(/\r?\n/), line = lines[reference.line - 1];
  if (!line?.includes(`"${reference.target}"`)) throw new Error("The portrait include changed. Reload trainer classes before creating this class.");
  const sections = lines.slice(0, reference.line).filter(line => /^\s*SECTION\b/.test(line.split(";", 1)[0]));
  const section = sections[sections.length - 1]?.split(";", 1)[0].trim();
  if (section !== 'SECTION "Trainer Pics", ROMX') throw new Error("Independent trainer portraits currently require the standard bank-relocatable Trainer Pics section.");
  const document = await loadGraphicsDocument(source, asset.path, catalog);
  const bytes = encodeGraphicsPng(document);
  lines.splice(reference.line, 0, `${label}::`, `\tINCBIN "${path.replace(/\.png$/, ".pic")}"`);
  const changes: TextWriteRequest[] = [
    { path, operation: "create", encoding: "hex", contents: bytesToHex(bytes) },
    { path: reference.path, contents: lines.join(text.includes("\r\n") ? "\r\n" : "\n"), expectedHash: await hashText(text) },
  ];
  if (await source.exists("layout.link")) {
    const layout = await source.readText("layout.link"), rows = layout.split(/\r?\n/);
    const pins = rows.map((row, i) => /^\s*"Trainer Pics"\s*(?:;.*)?$/.test(row) ? i : -1).filter(i => i >= 0);
    if (pins.length > 1) throw new Error("Trainer picture placement is ambiguous in the linker layout.");
    if (pins.length) {
      rows.splice(pins[0], 1);
      changes.push({ path: "layout.link", contents: rows.join(layout.includes("\r\n") ? "\r\n" : "\n"), expectedHash: await hashText(layout) });
    }
  }
  return { label, changes };
}
