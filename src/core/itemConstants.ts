export interface ItemConstantDefinition {
  id: number;
  constant: string;
  machineKind: "tm" | "hm" | null;
  machineNumber: number | null;
  moveConstant: string | null;
}

function codeOnly(line: string): string {
  return (line.split(";", 1)[0] || "").trim();
}

function parseAsmNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\$[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(1), 16);
  if (/^\d+$/.test(clean)) return Number.parseInt(clean, 10);
  return null;
}

export function parseItemConstantDefinitions(contents: string): ItemConstantDefinition[] {
  const result: ItemConstantDefinition[] = [];
  let currentId = 0;
  let regularItems = true;
  let hmNumber = 0;
  let tmNumber = 0;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = codeOnly(rawLine);
    if (!line) continue;

    const constDef = line.match(/^const_def(?:[ \t]+(.+))?$/);
    if (constDef) {
      currentId = constDef[1] ? (parseAsmNumber(constDef[1]) ?? currentId) : 0;
      continue;
    }

    const constNext = line.match(/^const_next[ \t]+([^ \t]+)/);
    if (constNext) {
      const next = parseAsmNumber(constNext[1]);
      if (next !== null) currentId = next;
      continue;
    }

    if (/^DEF[ \t]+NUM_ITEMS\b/.test(line)) {
      regularItems = false;
      continue;
    }

    if (regularItems) {
      const item = line.match(/^const[ \t]+([A-Za-z0-9_]+)/);
      if (item) {
        const id = currentId;
        currentId += 1;
        if (item[1] !== "NO_ITEM") {
          result.push({
            id,
            constant: item[1],
            machineKind: null,
            machineNumber: null,
            moveConstant: null,
          });
        }
        continue;
      }
    }

    const hm = line.match(/^add_hm[ \t]+([A-Za-z0-9_]+)/);
    if (hm) {
      hmNumber += 1;
      result.push({
        id: currentId,
        constant: `HM_${hm[1]}`,
        machineKind: "hm",
        machineNumber: hmNumber,
        moveConstant: hm[1],
      });
      currentId += 1;
      continue;
    }

    const tm = line.match(/^add_tm[ \t]+([A-Za-z0-9_]+)/);
    if (tm) {
      tmNumber += 1;
      result.push({
        id: currentId,
        constant: `TM_${tm[1]}`,
        machineKind: "tm",
        machineNumber: tmNumber,
        moveConstant: tm[1],
      });
      currentId += 1;
    }
  }

  return result;
}

export function tmhmMoveOptions(contents: string): string[] {
  const definitions = parseItemConstantDefinitions(contents);
  return [
    ...definitions
      .filter((item) => item.machineKind === "tm" && item.moveConstant)
      .map((item) => item.moveConstant as string),
    ...definitions
      .filter((item) => item.machineKind === "hm" && item.moveConstant)
      .map((item) => item.moveConstant as string),
  ];
}
