import type {
  BicycleRoutineParameters,
  ItemRoutineParameters,
  PpRestoreRoutineParameters,
  PpUpRoutineParameters,
  RepelRoutineParameters,
  ReviveRoutineParameters,
  VitaminRoutineParameters,
} from "./types";

const VITAMIN_STATS: Record<string, VitaminRoutineParameters["stat"]> = {
  HP_UP: "HP",
  PROTEIN: "Attack",
  IRON: "Defense",
  CARBOS: "Speed",
  CALCIUM: "Special",
};

const VITAMIN_CONSTANTS = ["HP_UP", "PROTEIN", "IRON", "CARBOS", "CALCIUM"];
const PP_RESTORE_SHARED = ["ETHER", "ELIXER"];

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function routineBlock(contents: string, label: string): string {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => codeOnly(line) === label || codeOnly(line) === label + ":");
  if (start < 0) throw new Error(`Could not locate ${label}.`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const clean = codeOnly(lines[i]);
    if (/^[A-Za-z_][A-Za-z0-9_]*::?$/.test(clean) && !clean.startsWith(".")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function parseRepel(contents: string, constant: string): RepelRoutineParameters | null {
  const labels: Record<string, string> = {
    REPEL: "ItemUseRepel:",
    SUPER_REPEL: "ItemUseSuperRepel:",
    MAX_REPEL: "ItemUseMaxRepel:",
  };
  const label = labels[constant];
  if (!label) return null;
  const block = routineBlock(contents, label);
  const match = block.match(/^\s*ld b,\s*(\d+)\b/m);
  if (!match) throw new Error(`Could not read ${constant} duration.`);
  return { kind: "repel", steps: Number.parseInt(match[1], 10) };
}

function parseVitamin(contents: string, constant: string): VitaminRoutineParameters | null {
  const stat = VITAMIN_STATS[constant];
  if (!stat) return null;

  const match = contents.match(
    /\.noCarry2\s*\r?\n\s*ld a,\s*(\d+)\s*\r?\n\s*ld b,\s*a\s*\r?\n\s*ld a,\s*\[hl\][^\r\n]*\r?\n\s*cp\s+(\d+)\b/i,
  );
  if (!match) throw new Error("Could not locate the shared vitamin Stat EXP constants.");

  return {
    kind: "vitamin",
    stat,
    statExpAdded: Number.parseInt(match[1], 10) * 256,
    useThreshold: Number.parseInt(match[2], 10) * 256,
    sharedConstants: VITAMIN_CONSTANTS,
  };
}

function parseRevive(contents: string, constant: string): ReviveRoutineParameters | null {
  if (constant === "MAX_REVIVE") {
    return { kind: "revive", restoreMode: "full", editable: false };
  }
  if (constant !== "REVIVE") return null;

  const match = contents.match(
    /cp REVIVE\s*\r?\n\s*jr z,\s*(\.setCurrentHPTo(?:HalfMaxHP|MaxHp))/i,
  );
  if (!match) throw new Error("Could not locate Revive HP recovery branch.");

  return {
    kind: "revive",
    restoreMode: /HalfMaxHP/i.test(match[1]) ? "half" : "full",
    editable: true,
  };
}

function parsePpRestore(contents: string, constant: string): PpRestoreRoutineParameters | null {
  if (constant === "MAX_ETHER" || constant === "MAX_ELIXER") {
    return {
      kind: "pp-restore",
      fullRestore: true,
      restoreAmount: null,
      sharedConstants: ["MAX_ETHER", "MAX_ELIXER"],
    };
  }
  if (constant !== "ETHER" && constant !== "ELIXER") return null;

  const blockStart = contents.indexOf(".restorePP");
  if (blockStart < 0) throw new Error("Could not locate the PP restoration routine.");
  const blockEnd = contents.indexOf(".fullyRestorePP", blockStart);
  const block = contents.slice(blockStart, blockEnd > blockStart ? blockEnd : undefined);
  const match = block.match(/^\s*add\s+(\d+)\s*;\s*increase current PP by\s+\d+/im)
    ?? block.match(/^\s*add\s+(\d+)\b/im);
  if (!match) throw new Error("Could not read Ether/Elixer PP restoration amount.");

  return {
    kind: "pp-restore",
    fullRestore: false,
    restoreAmount: Number.parseInt(match[1], 10),
    sharedConstants: PP_RESTORE_SHARED,
  };
}

function parsePpUp(contents: string, constant: string): PpUpRoutineParameters | null {
  if (constant !== "PP_UP") return null;
  const block = routineBlock(contents, "AddBonusPP:");
  const divisor = block.match(/ld a,\s*(\d+)\s*\r?\n\s*ldh \[hDivisor\],\s*a/i);
  const cap = block.match(/cp\s+(\d+)\s*;[^\r\n]*greater than or equal[^\r\n]*\r?\n\s*jr c,\s*\.addAmount\s*\r?\n\s*ld a,\s*(\d+)\s*;\s*cap the amount/i);
  if (!divisor || !cap) throw new Error("Could not read PP Up bonus constants.");

  const capThreshold = Number.parseInt(cap[1], 10);
  const capAmount = Number.parseInt(cap[2], 10);
  if (capThreshold !== capAmount + 1) {
    throw new Error("PP Up cap structure is not the supported vanilla form.");
  }

  return {
    kind: "pp-up",
    bonusDivisor: Number.parseInt(divisor[1], 10),
    perUseCap: capAmount,
    maxUses: 3,
  };
}

function parseBicycle(overworldContents: string | null): BicycleRoutineParameters {
  if (!overworldContents) throw new Error("Bicycle speed source is unavailable.");
  const block = routineBlock(overworldContents, "DoBikeSpeedup::");
  const extraAdvances = (block.match(/\b(?:call|jp)\s+AdvancePlayerSprite\b/g) ?? []).length;
  const speed = extraAdvances + 1;
  if (speed !== 1 && speed !== 2 && speed !== 4) {
    throw new Error(`Unsupported bicycle speed structure: ${speed}×.`);
  }
  const sourceVariant = /ld a, \[wWalkBikeSurfState\]/.test(block)
    ? "pokeyellow"
    : "pokered";
  return {
    kind: "bicycle",
    speedMultiplier: speed,
    sourceVariant,
  };
}

export function parseDeepItemRoutine(
  constant: string,
  useRoutine: string | null,
  effectsContents: string,
  overworldContents: string | null,
): ItemRoutineParameters | null {
  if (constant === "BICYCLE") return parseBicycle(overworldContents);
  return parseRepel(effectsContents, constant)
    ?? parseVitamin(effectsContents, constant)
    ?? parseRevive(effectsContents, constant)
    ?? parsePpRestore(effectsContents, constant)
    ?? parsePpUp(effectsContents, constant)
    ?? null;
}

function replaceFirstInRoutine(
  contents: string,
  label: string,
  pattern: RegExp,
  replacement: string,
): string {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => codeOnly(line) === label || codeOnly(line) === label + ":");
  if (start < 0) throw new Error(`Could not locate ${label}.`);
  for (let i = start + 1; i < lines.length; i += 1) {
    const clean = codeOnly(lines[i]);
    if (/^[A-Za-z_][A-Za-z0-9_]*::?$/.test(clean) && !clean.startsWith(".")) break;
    if (pattern.test(lines[i])) {
      lines[i] = lines[i].replace(pattern, replacement);
      return lines.join(newline);
    }
  }
  throw new Error(`Could not update ${label}.`);
}

function rewriteRepel(contents: string, constant: string, steps: number): string {
  if (!Number.isInteger(steps) || steps < 1 || steps > 255) {
    throw new Error("Repel duration must be a whole number from 1 to 255 steps.");
  }
  const labels: Record<string, string> = {
    REPEL: "ItemUseRepel:",
    SUPER_REPEL: "ItemUseSuperRepel:",
    MAX_REPEL: "ItemUseMaxRepel:",
  };
  const label = labels[constant];
  if (!label) throw new Error("Unsupported Repel item.");
  return replaceFirstInRoutine(
    contents,
    label,
    /^(\s*ld b,\s*)\d+\b/,
    `$1${steps}`,
  );
}

function rewriteVitamin(
  contents: string,
  values: VitaminRoutineParameters,
): string {
  if (
    !Number.isInteger(values.statExpAdded)
    || values.statExpAdded < 256
    || values.statExpAdded > 65280
    || values.statExpAdded % 256 !== 0
  ) {
    throw new Error("Vitamin Stat EXP added must be a multiple of 256 from 256 to 65280.");
  }
  if (
    !Number.isInteger(values.useThreshold)
    || values.useThreshold < 256
    || values.useThreshold > 65280
    || values.useThreshold % 256 !== 0
  ) {
    throw new Error("Vitamin use threshold must be a multiple of 256 from 256 to 65280.");
  }

  const amountByte = values.statExpAdded / 256;
  const thresholdByte = values.useThreshold / 256;
  const pattern =
    /(\.noCarry2\s*\r?\n\s*ld a,\s*)\d+(\s*\r?\n\s*ld b,\s*a\s*\r?\n\s*ld a,\s*\[hl\][^\r\n]*\r?\n\s*cp\s+)\d+\b/i;
  if (!pattern.test(contents)) {
    throw new Error("Could not locate the shared vitamin Stat EXP constants.");
  }
  return contents.replace(pattern, `$1${amountByte}$2${thresholdByte}`);
}

function rewriteRevive(
  contents: string,
  constant: string,
  values: ReviveRoutineParameters,
): string {
  if (constant !== "REVIVE" || !values.editable) {
    throw new Error("Max Revive remains a full-HP restore and is read-only.");
  }
  const target = values.restoreMode === "half"
    ? ".setCurrentHPToHalfMaxHP"
    : ".setCurrentHPToMaxHp";
  const pattern = /(cp REVIVE\s*\r?\n\s*jr z,\s*)\.setCurrentHPTo(?:HalfMaxHP|MaxHp)/i;
  if (!pattern.test(contents)) throw new Error("Could not locate Revive HP recovery branch.");
  return contents.replace(pattern, `$1${target}`);
}

function rewritePpRestore(
  contents: string,
  values: PpRestoreRoutineParameters,
): string {
  if (values.fullRestore || values.restoreAmount === null) {
    throw new Error("Max Ether and Max Elixer restore PP fully and are read-only.");
  }
  if (!Number.isInteger(values.restoreAmount) || values.restoreAmount < 1 || values.restoreAmount > 63) {
    throw new Error("Ether/Elixer PP restored must be a whole number from 1 to 63.");
  }
  const start = contents.indexOf(".restorePP");
  const end = contents.indexOf(".fullyRestorePP", start);
  if (start < 0 || end < start) throw new Error("Could not locate the PP restoration routine.");
  const before = contents.slice(0, start);
  const block = contents.slice(start, end);
  const after = contents.slice(end);
  const pattern = /^(\s*add\s+)\d+(\s*;\s*increase current PP by\s+)\d+/im;
  if (!pattern.test(block)) throw new Error("Could not locate Ether/Elixer PP restoration amount.");
  return before + block.replace(
    pattern,
    `$1${values.restoreAmount}$2${values.restoreAmount}`,
  ) + after;
}

function rewritePpUp(contents: string, values: PpUpRoutineParameters): string {
  if (!Number.isInteger(values.bonusDivisor) || values.bonusDivisor < 1 || values.bonusDivisor > 255) {
    throw new Error("PP Up divisor must be a whole number from 1 to 255.");
  }
  if (!Number.isInteger(values.perUseCap) || values.perUseCap < 1 || values.perUseCap > 7) {
    throw new Error("PP Up per-use cap must be a whole number from 1 to 7.");
  }
  if (values.maxUses !== 3) {
    throw new Error("The Gen I PP data format stores at most 3 PP Ups; this limit is read-only.");
  }

  const start = contents.indexOf("AddBonusPP:");
  const end = contents.indexOf("\nGetMaxPP:", start);
  if (start < 0 || end < start) throw new Error("Could not locate AddBonusPP.");
  const before = contents.slice(0, start);
  let block = contents.slice(start, end);
  const after = contents.slice(end);

  const divisorPattern = /(ld a,\s*)\d+(\s*\r?\n\s*ldh \[hDivisor\],\s*a)/i;
  const capPattern = /(cp\s+)\d+(\s*;[^\r\n]*greater than or equal[^\r\n]*\r?\n\s*jr c,\s*\.addAmount\s*\r?\n\s*ld a,\s*)\d+(\s*;\s*cap the amount at\s*)\d+/i;
  if (!divisorPattern.test(block) || !capPattern.test(block)) {
    throw new Error("Could not locate PP Up bonus constants.");
  }

  block = block.replace(divisorPattern, `$1${values.bonusDivisor}$2`);
  block = block.replace(
    capPattern,
    `$1${values.perUseCap + 1}$2${values.perUseCap}$3${values.perUseCap}`,
  );
  return before + block + after;
}

function rewriteBicycle(
  overworldContents: string,
  values: BicycleRoutineParameters,
): string {
  if (![1, 2, 4].includes(values.speedMultiplier)) {
    throw new Error("Bicycle speed must be 1×, 2×, or 4×.");
  }

  const newline = overworldContents.includes("\r\n") ? "\r\n" : "\n";
  const lines = overworldContents.split(/\r?\n/);
  const functionStart = lines.findIndex((line) => codeOnly(line) === "DoBikeSpeedup::");
  if (functionStart < 0) throw new Error("Could not locate DoBikeSpeedup.");

  const goFaster = lines.findIndex(
    (line, index) => index > functionStart && codeOnly(line) === ".goFaster",
  );
  if (goFaster < 0) throw new Error("Could not locate DoBikeSpeedup .goFaster block.");

  let nextGlobal = lines.length;
  for (let i = goFaster + 1; i < lines.length; i += 1) {
    const clean = codeOnly(lines[i]);
    if (/^[A-Za-z_][A-Za-z0-9_]*::?$/.test(clean) && !clean.startsWith(".")) {
      nextGlobal = i;
      break;
    }
  }

  const calls = Array.from(
    { length: values.speedMultiplier - 1 },
    () => "\tcall AdvancePlayerSprite",
  );
  const replacement = [...calls, "\tret", ""];
  lines.splice(goFaster + 1, nextGlobal - (goFaster + 1), ...replacement);
  return lines.join(newline);
}

export function rewriteDeepItemRoutine(
  constant: string,
  original: ItemRoutineParameters,
  values: ItemRoutineParameters,
  effectsContents: string,
  overworldContents: string | null,
): { effectsContents: string; overworldContents: string | null } | null {
  if (original.kind !== values.kind) {
    throw new Error("The item routine type changed. Reload the item before saving.");
  }

  switch (values.kind) {
    case "repel":
      return {
        effectsContents: rewriteRepel(effectsContents, constant, values.steps),
        overworldContents,
      };
    case "vitamin":
      return {
        effectsContents: rewriteVitamin(effectsContents, values),
        overworldContents,
      };
    case "revive":
      return {
        effectsContents: rewriteRevive(effectsContents, constant, values),
        overworldContents,
      };
    case "pp-restore":
      return {
        effectsContents: rewritePpRestore(effectsContents, values),
        overworldContents,
      };
    case "pp-up":
      return {
        effectsContents: rewritePpUp(effectsContents, values),
        overworldContents,
      };
    case "bicycle":
      if (!overworldContents) throw new Error("Bicycle speed source is unavailable.");
      return {
        effectsContents,
        overworldContents: rewriteBicycle(overworldContents, values),
      };
    default:
      return null;
  }
}
