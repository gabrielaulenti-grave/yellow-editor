import { evaluateRgbdsExpression, projectConstantCatalogFromSources } from "./projectConstants";
import { parseMoves } from "./parsers";
import type { GraphicsCatalog } from "./graphics";
import type { MoveData, ProjectSource } from "./types";

export interface AnimationSource { path: string; line: number; text: string }
export interface AnimationSprite { x: number; y: number; tile: number; flipX: boolean; flipY: boolean }
export interface AnimationFrameBlock { id: number; label: string; sprites: AnimationSprite[]; source: AnimationSource; warnings: string[] }
export interface AnimationFrame {
  block: string; blockId: number | null; coordinate: string; x: number | null; y: number | null;
  mode: string; modeId: number | null; source: AnimationSource;
}
export interface BattleSubanimation {
  id: number; label: string; type: string; frames: AnimationFrame[]; source: AnimationSource; warnings: string[];
}
export interface BattleAnimationStep {
  kind: "subanimation" | "effect" | "unknown"; sound: string; target: string; targetId: number | null;
  sheetId: number | null; delay: number | null; source: AnimationSource;
}
export interface BattleAnimationScript { id: number; constant: string; label: string; steps: BattleAnimationStep[]; source: AnimationSource; warnings: string[] }
export interface BattleAnimationEffect { constant: string; id: number; routine: string; source: AnimationSource; routineSource: AnimationSource | null }
export interface BattleAnimationHook { animationId: number | null; constant: string; routine: string; source: AnimationSource; routineSource: AnimationSource | null }
export interface BattleAnimationSheet { id: number; label: string; tileCount: number | null; path: string | null; source: AnimationSource }
export interface BattleAnimationCatalog {
  moves: Array<MoveData & { animationId: number | null }>;
  scripts: BattleAnimationScript[]; subanimations: BattleSubanimation[]; blocks: AnimationFrameBlock[];
  effects: BattleAnimationEffect[]; hooks: BattleAnimationHook[]; sheets: BattleAnimationSheet[];
  impacts: Array<{ constant: string; routine: string; source: AnimationSource }>;
  engineNotes: AnimationSource[]; warnings: string[];
}

const paths = {
  animations: "data/moves/animations.asm", constants: "constants/move_animation_constants.asm",
  moves: "constants/move_constants.asm", battle: "constants/battle_anim_constants.asm",
  subanimations: "data/battle_anims/subanimations.asm", blocks: "data/battle_anims/frame_blocks.asm",
  coords: "data/battle_anims/base_coords.asm", effects: "data/battle_anims/special_effect_pointers.asm",
  hooks: "data/battle_anims/special_effects.asm", engine: "engine/battle/animations.asm",
};
const clean = (line: string) => line.split(";", 1)[0].trim();
const args = (code: string) => code.replace(/^\S+\s*/, "").split(",").map(part => part.trim());
interface Row { code: string; raw: string; line: number }
class Assembly {
  rows: Row[] = [];
  labels = new Map<string, number>();
  lines: string[];
  constructor(readonly path: string, text: string) {
    this.lines = text.split(/\r?\n/);
    let macro = false;
    this.lines.forEach((raw, i) => {
      let code = clean(raw);
      if (/^MACRO\??\s/i.test(code)) { macro = true; return; }
      if (/^ENDM\b/i.test(code)) { macro = false; return; }
      if (macro || !code) return;
      const label = code.match(/^([A-Za-z_][\w]*):{1,2}/);
      if (label) { this.labels.set(label[1], this.rows.length); code = code.slice(label[0].length).trim(); }
      this.rows.push({ code, raw, line: i + 1 });
    });
  }
  source(rows: Row[]): AnimationSource { return { path: this.path, line: rows[0]?.line ?? 1, text: rows.length ? this.lines.slice(rows[0].line - 1, rows[rows.length - 1].line).join("\n") : "" }; }
  block(label: string): Row[] {
    const at = this.labels.get(label); if (at === undefined) return [];
    let end = at + 1;
    // Adjacent labels are aliases. A later label after data or instructions starts a new block.
    let hasCode = Boolean(this.rows[at].code);
    const starts = new Set(this.labels.values());
    for (; end < this.rows.length; end++) {
      if (starts.has(end) && hasCode) break;
      hasCode ||= Boolean(this.rows[end].code);
    }
    return this.rows.slice(at, end);
  }
  table(label: string): Row[] { return this.block(label).filter(row => row.code && !/^(?:table_width|assert_table_length)\b/.test(row.code)); }
  stream(label: string, consume: (row: Row) => boolean): Row[] {
    const at = this.labels.get(label); if (at === undefined) return [];
    const rows: Row[] = [];
    for (const row of this.rows.slice(at)) { rows.push(row); if (row.code && !consume(row)) break; }
    return rows;
  }
}

/** Reads source structure without executing RGBDS macros or emulating effect routines. */
export async function loadBattleAnimationCatalog(source: ProjectSource, graphics: GraphicsCatalog): Promise<BattleAnimationCatalog> {
  const warnings: string[] = [];
  const files = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    try { return { key, path, contents: await source.readText(path) }; }
    catch { warnings.push(`Cannot read ${path}; some animation details are unavailable.`); return { key, path, contents: "" }; }
  }));
  const assembly = Object.fromEntries(files.map(file => [file.key, new Assembly(file.path, file.contents)]));
  const constants = projectConstantCatalogFromSources(files.filter(file => ["constants", "moves", "battle"].includes(file.key)));
  const symbols = new Map(constants.constants.map(constant => [constant.symbol, constant.value]));
  const number = (expression: string | undefined) => expression ? evaluateRgbdsExpression(expression, symbols) : null;
  const constantName = (id: number, file: string, prefix = "") => constants.constants.find(c => c.sourcePath === file && c.value === id && c.symbol.startsWith(prefix))?.symbol;
  const pointerLabels = (key: string, label: string) => {
    const rows = assembly[key].table(label), unsupported = rows.find(row => !/^dw\s/.test(row.code));
    if (unsupported) { warnings.push(`${assembly[key].path}:${unsupported.line}: unsupported pointer-table structure; ${label} was not interpreted.`); return []; }
    return rows.flatMap(row => args(row.code));
  };
  const routineSource = (label: string) => {
    const rows = assembly.engine.block(label);
    return rows.length ? assembly.engine.source(rows) : null;
  };
  const coordinateRows = assembly.coords.table("FrameBlockBaseCoords");
  const coords = coordinateRows.map(row => /^db\s/.test(row.code) && args(row.code).length === 2 ? args(row.code).map(number) : [null, null]);
  const blocks: AnimationFrameBlock[] = pointerLabels("blocks", "FrameBlockPointers").map((label, id) => {
    const blockWarnings: string[] = [], sprites: AnimationSprite[] = [];
    let count: number | null = null;
    const rows = assembly.blocks.stream(label, row => {
      if (!row.code) return true;
      if (count === null && /^db\s/.test(row.code)) { count = number(args(row.code)[0]); return count !== null && count > 0; }
      if (count === null || !/^dbsprite\s/.test(row.code)) { blockWarnings.push(`Unsupported frame data at line ${row.line}.`); return false; }
      const values = args(row.code), numeric = values.slice(0, 5).map(number);
      const flags = values[5]?.split("|").map(value => value.trim()) ?? [];
      if (numeric.some(value => value === null) || values.length !== 6 || flags.some(flag => !["0", "OAM_XFLIP", "OAM_YFLIP", "OAM_PAL1", "OAM_PRIO"].includes(flag))) {
        blockWarnings.push(`Unresolved sprite at line ${row.line}.`); return false;
      }
      const [tx, ty, px, py, tile] = numeric as number[];
      const signed = (value: number) => { const byte = (value % 256 + 256) % 256; return byte > 127 ? byte - 256 : byte; };
      sprites.push({ x: signed(tx * 8 + px), y: signed(ty * 8 + py), tile, flipX: flags.includes("OAM_XFLIP"), flipY: flags.includes("OAM_YFLIP") });
      return sprites.length < count;
    });
    if (count !== sprites.length) blockWarnings.push(`Expected ${count ?? "an unknown number of"} sprites; resolved ${sprites.length}.`);
    return { id, label, sprites, source: assembly.blocks.source(rows), warnings: blockWarnings };
  });
  const subanimations: BattleSubanimation[] = pointerLabels("subanimations", "SubanimationPointers").map((label, id) => {
    const subWarnings: string[] = [], frames: AnimationFrame[] = [];
    let count: number | null = null, type = "Unresolved";
    const rows = assembly.subanimations.stream(label, row => {
      if (!row.code) return true;
      if (count === null && /^subanim\s/.test(row.code)) { const values = args(row.code); type = values[0]; count = number(values[1]); return count !== null && count > 0; }
      if (count === null || !/^db\s/.test(row.code)) { subWarnings.push(`Unsupported sequence data at line ${row.line}.`); return false; }
      const values = args(row.code), blockId = number(values[0]), coordinateId = number(values[1]), modeId = number(values[2]);
      const coordinate = coordinateId === null ? null : coords[coordinateId];
      frames.push({ block: values[0], blockId, coordinate: values[1], y: coordinate?.[0] ?? null, x: coordinate?.[1] ?? null, mode: values[2], modeId, source: assembly.subanimations.source([row]) });
      if (values.length !== 3 || blockId === null || !blocks[blockId] || !coordinate || coordinate.some(value => value === null) || modeId === null || modeId < 0 || modeId > 4) subWarnings.push(`Unresolved frame at line ${row.line}.`);
      return frames.length < count;
    });
    if (count !== frames.length) subWarnings.push(`Expected ${count ?? "an unknown number of"} frames; resolved ${frames.length}.`);
    return { id, label, type, frames, source: assembly.subanimations.source(rows), warnings: subWarnings };
  });
  const scripts: BattleAnimationScript[] = pointerLabels("animations", "AttackAnimationPointers").map((label, index) => {
    const scriptWarnings: string[] = [], steps: BattleAnimationStep[] = []; let terminated = false;
    const rows = assembly.animations.stream(label, row => {
      if (!row.code) return true;
      if (/^db\s/.test(row.code) && number(args(row.code)[0]) === -1) { terminated = true; return false; }
      if (!/^battle_anim\s/.test(row.code)) { scriptWarnings.push(`Unsupported animation command at line ${row.line}; remaining steps were not interpreted.`); steps.push({ kind: "unknown", target: row.code, sound: "", targetId: null, sheetId: null, delay: null, source: assembly.animations.source([row]) }); return false; }
      const values = args(row.code), targetId = number(values[1]);
      const kind = values.length === 4 ? "subanimation" : values.length === 2 ? "effect" : "unknown";
      const sheetId = kind === "subanimation" ? number(values[2]) : null, delay = kind === "subanimation" ? number(values[3]) : null;
      steps.push({ kind, target: values[1] || row.code, targetId, sound: values[0], sheetId, delay, source: assembly.animations.source([row]) });
      if (kind === "unknown" || targetId === null || kind === "subanimation" && (sheetId === null || delay === null || delay < 0 || delay > 63 || !subanimations[targetId])) scriptWarnings.push(`Unresolved command at line ${row.line}.`);
      return kind !== "unknown";
    });
    if (!terminated) scriptWarnings.push("Animation terminator was not resolved.");
    return { id: index + 1, constant: constantName(index + 1, paths.moves) ?? `Animation ${index + 1}`, label, steps, source: assembly.animations.source(rows), warnings: scriptWarnings };
  });
  const effects: BattleAnimationEffect[] = assembly.effects.table("SpecialEffectPointers").filter(row => /^special_effect\s/.test(row.code)).map(row => {
    const [constant, routine] = args(row.code);
    return { constant, id: number(constant) ?? -1, routine, source: assembly.effects.source([row]), routineSource: routineSource(routine) };
  });
  const hooks: BattleAnimationHook[] = assembly.hooks.table("AnimationIdSpecialEffects").filter(row => /^anim_special_effect\s/.test(row.code)).map(row => {
    const [constant, routine] = args(row.code);
    return { constant, animationId: number(constant), routine, source: assembly.hooks.source([row]), routineSource: routineSource(routine) };
  });
  const sheets: BattleAnimationSheet[] = assembly.engine.table("MoveAnimationTilesPointers").filter(row => /^anim_tileset\s/.test(row.code)).map((row, id) => {
    const [tiles, label] = args(row.code), include = assembly.engine.block(label).find(row => /^INCBIN\s/.test(row.code));
    const target = include?.code.match(/^INCBIN\s+"([^"\n]+)"\s*$/)?.[1];
    const stem = (path: string) => path.replace(/\.(png|1bpp|2bpp|pic)$/, "");
    const path = target ? graphics.assets.find(asset => stem(asset.path) === stem(target))?.path ?? null : null;
    return { id, label, tileCount: number(tiles), path, source: assembly.engine.source([row]) };
  });
  for (const script of scripts) for (const step of script.steps) {
    if (step.kind === "effect" && !effects.some(effect => effect.id === step.targetId)) script.warnings.push(`Effect ${step.target} has no resolved routine.`);
    if (step.kind === "subanimation" && !sheets.some(sheet => sheet.id === step.sheetId && sheet.path)) script.warnings.push(`Tile sheet ${step.sheetId ?? "unknown"} has no resolved source artwork.`);
  }
  const impacts = pointerLabels("engine", "AnimationTypePointerTable").map((routine, i) => ({ constant: constantName(i + 1, paths.battle, "ANIMATIONTYPE_") ?? `Animation type ${i + 1}`, routine, source: routineSource(routine) ?? assembly.engine.source([]) }));
  const engineNotes = ["ShareMoveAnimations", "PlayApplyingAttackAnimation"].map(routineSource).filter((entry): entry is AnimationSource => entry !== null);
  const moves = (await parseMoves(source)).map(move => ({ ...move, animationId: number(move.animation) }));
  return { moves, scripts, subanimations, blocks, effects, hooks, sheets, impacts, engineNotes, warnings };
}

export const animationTitle = (name: string) => (name || "Unresolved").replace(/^(?:SUBANIM_|SE_|SUBANIMTYPE_|ANIMATIONTYPE_)/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, char => char.toUpperCase());

/** Isolated, untransformed frame composition. Palette index zero is sprite transparency. */
export function composeAnimationFrame(block: AnimationFrameBlock, sheet: { width: number; height: number; pixels: number[] }, tileCount: number) {
  if (block.warnings.length || !block.sprites.length) return null;
  if (block.sprites.some(sprite => sprite.tile < 0 || sprite.tile >= tileCount || sprite.tile * 64 >= sheet.width * sheet.height)) return null;
  const x = Math.min(...block.sprites.map(sprite => sprite.x)), y = Math.min(...block.sprites.map(sprite => sprite.y));
  const width = Math.max(...block.sprites.map(sprite => sprite.x + 8)) - x, height = Math.max(...block.sprites.map(sprite => sprite.y + 8)) - y;
  if (width > 256 || height > 256 || sheet.width % 8) return null;
  const pixels: Array<number | null> = new Array(width * height).fill(null);
  // Earlier OAM entries win overlaps, as on the Game Boy.
  for (const sprite of block.sprites.slice().reverse()) for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
    const sx = sprite.tile % (sheet.width / 8) * 8 + (sprite.flipX ? 7 - dx : dx);
    const sy = Math.floor(sprite.tile / (sheet.width / 8)) * 8 + (sprite.flipY ? 7 - dy : dy);
    const shade = sheet.pixels[sy * sheet.width + sx];
    if (shade) pixels[(sprite.y - y + dy) * width + sprite.x - x + dx] = shade;
  }
  return { width, height, pixels };
}
