import { bytesToHex, hashText } from "./history";
import { decodeGen1Png, encodeGen1RgbaToTiles } from "./gen1Graphics";
import { decodeGraphicsTiles, encodeGraphicsPng, graphicsPixelsFromImage, graphicsPixelsToImage, validateGraphicsPixels, validateGraphicsPngHeader, type GraphicsPixels } from "./graphicsPixels";
import type { ProjectSource, TextWriteRequest } from "./types";

export type GraphicsCategory = "pokemon" | "trainers" | "tilesets" | "sprites" | "battle" | "interface" | "scenes" | "other";
export interface GraphicsReference { path: string; line: number; labels: string[]; target: string; slice: string }
export interface GraphicsAsset {
  path: string;
  name: string;
  category: GraphicsCategory;
  format: "png" | "1bpp" | "2bpp" | "pic";
  depth: 1 | 2;
  references: GraphicsReference[];
  reason: string | null;
}
export interface GraphicsCatalog { assets: GraphicsAsset[]; warnings: string[] }
export interface GraphicsDocument extends GraphicsPixels {
  asset: GraphicsAsset;
  sourceHash: string;
  referenceHash: string;
}
export interface GraphicsValues { pixels: number[]; confirmShared: boolean }
export interface GraphicsFocus { path?: string; label?: string; mapConstant?: string; returnTab: "pokemon" | "trainers" | "maps"; palette?: string[] }

function category(path: string): GraphicsCategory {
  if (/\/(?:pokemon|pics)\//i.test(path)) return "pokemon";
  if (/\/trainers\//i.test(path)) return "trainers";
  if (/\/tilesets\//i.test(path)) return "tilesets";
  if (/\/(?:sprites|overworld)\//i.test(path)) return "sprites";
  if (/\/battle\//i.test(path)) return "battle";
  if (/\/(?:font|fonts|text|border|borders|town_map|pokedex|menu|menus)\//i.test(path)) return "interface";
  if (/\/(?:intro|title|credits|trade|pikachu|surfing_pikachu|sgb|diploma|slots|evolution|fishing)\//i.test(path)) return "scenes";
  return "other";
}
function stem(path: string): string { return path.replace(/\.(?:png|1bpp|2bpp|pic)$/i, ""); }
function assetName(path: string): string {
  return stem(path).replace(/^gfx\//i, "").split("/").map(part => part.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(" / ");
}
function clean(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ";" && !quoted) return line.slice(0, i).trim();
  }
  return line.trim();
}

/** All literal source references are retained, including inactive variants and aliases. */
export async function loadGraphicsCatalog(source: ProjectSource): Promise<GraphicsCatalog> {
  if (!source.listFiles) throw new Error("This project source cannot list graphics files.");
  const files = (await source.listFiles()).filter(path => !path.startsWith(".") && !path.split("/").includes(".."));
  const references: GraphicsReference[] = [], warnings: string[] = [];
  const assembly = files.filter(path => /\.(asm|inc)$/i.test(path));
  for (let at = 0; at < assembly.length; at += 12) {
    const batch = await Promise.all(assembly.slice(at, at + 12).map(async path => ({ path, contents: await source.readText(path) })));
    for (const { path, contents } of batch) {
      let labels: string[] = [];
      contents.split(/\r?\n/).forEach((raw, line) => {
        let code = clean(raw);
        if (!code) return;
        const label = code.match(/^([A-Za-z_][A-Za-z0-9_]*):{1,2}/);
        if (label) { labels.push(label[1]); code = code.slice(label[0].length).trim(); }
        if (!code) return;
        const match = code.match(/^INCBIN\s+"([^"\n]+\.(?:png|1bpp|2bpp|pic))"(.*)$/i);
        if (match) references.push({ path, line: line + 1, labels: labels.slice(), target: match[1], slice: match[2].trim() });
        else if (/\bINCBIN\b/.test(code) && !/^INCBIN\s+"/.test(code)) warnings.push(`${path}:${line + 1}: computed binary path; its graphics references need source review.`);
        labels = [];
      });
    }
  }
  const candidates = new Set(files.filter(path => /\.(png|1bpp|2bpp|pic)$/i.test(path) && (path.startsWith("gfx/") || references.some(ref => stem(ref.target) === stem(path)))));
  const grouped = new Map<string, string[]>();
  for (const path of candidates) grouped.set(stem(path), [...grouped.get(stem(path)) ?? [], path]);
  const assets: GraphicsAsset[] = [];
  const groups: Array<[string, string[]]> = [];
  for (const [base, paths] of grouped) {
    if (paths.some(path => path.endsWith(".png"))) groups.push([base, paths]);
    else {
      const one = paths.filter(path => path.endsWith(".1bpp")), other = paths.filter(path => !path.endsWith(".1bpp"));
      if (one.length) groups.push([base, one]);
      if (other.length) groups.push([base, other]);
    }
  }
  for (const [base, paths] of groups) {
    // Match the ROM build's source precedence; generated siblings are never edited.
    paths.sort((a, b) => ["png", "2bpp", "1bpp", "pic"].indexOf(a.split(".").pop()!) - ["png", "2bpp", "1bpp", "pic"].indexOf(b.split(".").pop()!));
    const path = paths[0], format = path.split(".").pop()! as GraphicsAsset["format"];
    const refs = references.filter(ref => stem(ref.target) === base && (format === "png" || ref.target.endsWith(".1bpp") === (format === "1bpp"))).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const depths = new Set(refs.map(ref => ref.target.endsWith(".1bpp") ? 1 : 2));
    const depth = format === "1bpp" || depths.size === 1 && depths.has(1) ? 1 : 2;
    let reason: string | null = null;
    if (format === "pic") reason = "Only compressed .pic data is present. Add its source PNG or uncompressed tiles before pixel editing.";
    if (format === "png" && depths.size > 1) reason = "This PNG is built at multiple bit depths. Its conversions need review before editing.";
    if (["gfx/trade/game_boy", "gfx/intro/gengar", "gfx/credits/the_end"].includes(base)) reason = "This graphic uses tile deduplication or interleaving. Its composition needs a dedicated editor before pixel changes can be saved.";
    if (refs.some(ref => ref.slice && !(ref.target.endsWith(".pic") && /^,\s*0\s*,\s*1$/.test(ref.slice)))) {
      reason = "This graphic has sliced binary references. Their layout needs review before editing.";
    }
    assets.push({ path, name: assetName(path), category: category(path), format, depth, references: refs, reason });
  }
  return { assets: assets.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

async function referenceHash(source: ProjectSource, asset: GraphicsAsset): Promise<string> {
  return hashText(JSON.stringify({ asset, makefile: await source.exists("Makefile") ? await source.readText("Makefile") : null }));
}
export async function loadGraphicsDocument(source: ProjectSource, path: string, catalog?: GraphicsCatalog): Promise<GraphicsDocument> {
  const asset = (catalog ?? await loadGraphicsCatalog(source)).assets.find(asset => asset.path === path);
  if (!asset) throw new Error("This graphic no longer matches the source catalogue. Refresh the asset browser.");
  if (asset.reason) throw new Error(asset.reason);
  const bytes = await source.readBytes(path);
  if (bytes.length > 16 * 1024 * 1024) throw new Error("This graphics file exceeds the 16 MB editor limit.");
  let image: GraphicsPixels;
  if (asset.format === "png") {
    validateGraphicsPngHeader(bytes);
    image = graphicsPixelsFromImage(await decodeGen1Png(bytes), asset.depth);
  } else image = decodeGraphicsTiles(bytes, asset.depth);
  validateGraphicsPixels(image);
  return { ...image, asset, sourceHash: await hashText(bytesToHex(bytes)), referenceHash: await referenceHash(source, asset) };
}

export async function prepareGraphicsWrites(source: ProjectSource, document: GraphicsDocument, values: GraphicsValues): Promise<TextWriteRequest[]> {
  // Re-discover references and source precedence, so new aliases/slices/PNGs cannot bypass a stale document.
  const fresh = await loadGraphicsDocument(source, document.asset.path);
  if (fresh.sourceHash !== document.sourceHash || fresh.referenceHash !== document.referenceHash) throw new Error("Graphics sources or references changed. Reopen the graphic before saving; your draft is still available.");
  if (document.width !== fresh.width || document.height !== fresh.height || document.depth !== fresh.depth) throw new Error("Graphics dimensions and bit depth cannot change in this editor.");
  const image = { width: fresh.width, height: fresh.height, depth: fresh.depth, pixels: values.pixels };
  validateGraphicsPixels(image);
  if (values.pixels.every((pixel, i) => pixel === fresh.pixels[i])) return [];
  if (!values.confirmShared && fresh.asset.references.length) throw new Error("Acknowledge that editing this source changes all of its uses before saving.");
  if (fresh.asset.format === "png" && fresh.asset.category === "tilesets") {
    const trimmedCount = (pixels: number[]) => {
      const bytes = encodeGen1RgbaToTiles(graphicsPixelsToImage({ ...image, pixels }), { depth: image.depth });
      const size = image.depth * 8, preserve = fresh.asset.path === "gfx/tilesets/reds_house.png" ? 0x48 : 0;
      let count = bytes.length / size;
      while (count > 1 && count - 1 !== preserve && bytes.subarray((count - 1) * size, count * size).every(byte => byte === 0)) count--;
      return count;
    };
    if (trimmedCount(fresh.pixels) !== trimmedCount(values.pixels)) throw new Error("This edit changes the number of built tiles by altering trailing blank tiles. Keep the existing tile slots in this first-pass editor.");
  }
  const bytes = fresh.asset.format === "png" ? encodeGraphicsPng(image) : encodeGen1RgbaToTiles(graphicsPixelsToImage(image), { depth: image.depth });
  return [{ path: fresh.asset.path, contents: bytesToHex(bytes), encoding: "hex", expectedHash: fresh.sourceHash }];
}
