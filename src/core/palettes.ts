import type { PokemonPaletteData, PokemonPaletteOption, ProjectSource } from "./types";

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] ?? "").trim();
}

function parseAsmNumber(value: string): number {
  const trimmed = value.trim();
  if (/^\$[0-9a-f]+$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(1), 16);
  }
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  throw new Error(`Expected assembly integer, got '${value}'`);
}

function parsePokedexConstants(contents: string): Map<string, number> {
  const result = new Map<string, number>();
  let current = 0;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line) {
      continue;
    }

    if (line.startsWith("const_def")) {
      const value = line.slice("const_def".length).trim();
      current = value ? parseAsmNumber(value) : 0;
      continue;
    }

    if (line === "const_skip") {
      current += 1;
      continue;
    }

    if (line.startsWith("const ")) {
      const constant = line.slice("const ".length).trim();
      result.set(constant, current);
      current += 1;
    }
  }

  return result;
}

function parseMonsterPalettes(contents: string): string[] {
  const palettes: string[] = [];
  let inTable = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);

    if (line === "MonsterPalettes:") {
      inTable = true;
      continue;
    }

    if (!inTable) {
      continue;
    }

    if (line.startsWith("assert_table_length")) {
      break;
    }

    if (line.startsWith("db ")) {
      const palette = line.slice(3).trim();
      if (palette) {
        palettes.push(palette);
      }
    }
  }

  return palettes;
}

function toHexChannel(value5: number): string {
  const value8 = Math.round((value5 / 31) * 255);
  return value8.toString(16).padStart(2, "0");
}

function rgb5ToHex(red: number, green: number, blue: number): string {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

function parsePaletteBlock(
  contents: string,
  blockLabel: string,
  paletteConstant: string,
  source: PokemonPaletteOption["source"],
): PokemonPaletteOption | null {
  let inBlock = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed === `${blockLabel}:`) {
      inBlock = true;
      continue;
    }

    if (!inBlock) {
      continue;
    }

    if (trimmed.startsWith("assert_table_length")) {
      break;
    }

    if (!trimmed.startsWith("RGB ")) {
      continue;
    }

    const semicolon = rawLine.indexOf(";");
    if (semicolon < 0) {
      continue;
    }

    const comment = rawLine.slice(semicolon + 1).trim();
    if (comment !== paletteConstant) {
      continue;
    }

    const code = rawLine.slice(0, semicolon).trim();
    const values = code
      .slice("RGB ".length)
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10));

    if (
      values.length !== 12 ||
      values.some((value) => !Number.isInteger(value) || value < 0 || value > 31)
    ) {
      throw new Error(`Invalid RGB palette row for ${paletteConstant}`);
    }

    const colors = [0, 3, 6, 9].map((offset) =>
      rgb5ToHex(values[offset], values[offset + 1], values[offset + 2]),
    ) as [string, string, string, string];

    return {
      source,
      label: source === "cgb" ? "Game Boy Color" : "Super Game Boy",
      colors,
    };
  }

  return null;
}

export async function parsePokemonPalette(
  source: ProjectSource,
  dexConstant: string,
): Promise<PokemonPaletteData | null> {
  const [dexConstants, monsterPalettes, paletteDefinitions] = await Promise.all([
    source.readText("constants/pokedex_constants.asm"),
    source.readText("data/pokemon/palettes.asm"),
    source.readText("data/sgb/sgb_palettes.asm"),
  ]);

  const dexNumber = parsePokedexConstants(dexConstants).get(dexConstant);
  if (dexNumber === undefined) {
    return null;
  }

  const paletteConstant = parseMonsterPalettes(monsterPalettes)[dexNumber];
  if (!paletteConstant) {
    return null;
  }

  const options: PokemonPaletteOption[] = [];
  const cgb = parsePaletteBlock(
    paletteDefinitions,
    "CGBBasePalettes",
    paletteConstant,
    "cgb",
  );
  const sgb = parsePaletteBlock(
    paletteDefinitions,
    "SuperPalettes",
    paletteConstant,
    "sgb",
  );

  if (cgb) {
    options.push(cgb);
  }
  if (sgb) {
    options.push(sgb);
  }

  return {
    constant: paletteConstant,
    dexNumber,
    options,
  };
}
