export type TextPreviewControl =
  | "text"
  | "next"
  | "line"
  | "cont"
  | "para"
  | "page";

export interface RuntimeTextCommandPreview {
  kind: "dynamic" | "break" | "passthrough";
  text?: string;
  maxWidth?: number;
  safeToEdit: boolean;
}

const QUOTED_TEXT_PATTERN = /^(text|next|line|cont|para|page)\s+"((?:[^"\\]|\\.)*)"/i;

function withoutComment(line: string): string {
  return line.split(";", 1)[0].trim();
}

export function decodeAsmTextString(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function visibleAsmText(value: string): string {
  const decoded = decodeAsmTextString(value);
  const terminator = decoded.indexOf("@");
  return terminator >= 0 ? decoded.slice(0, terminator) : decoded;
}

function parseNumber(value: string): number | null {
  const clean = value.trim();
  if (/^\d+$/.test(clean)) return Number(clean);
  if (/^\$[0-9a-f]+$/i.test(clean)) return Number.parseInt(clean.slice(1), 16);
  return null;
}

function humanizeVariable(value: string): string {
  return value
    .replace(/^w(?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

function ramPlaceholder(address: string): { text: string; maxWidth: number | null } {
  if (/^wNameBuffer$/i.test(address)) {
    return { text: "<name>", maxWidth: 10 };
  }
  if (/^wStringBuffer$/i.test(address)) {
    // Gen I commonly uses this for item names. Yellow item names can occupy up
    // to 12 character cells, which also safely covers Pokémon names.
    return { text: "<item/name>", maxWidth: 12 };
  }
  if (/mon.*name|pokemon.*name|nickname/i.test(address)) {
    return { text: "<Pokémon name>", maxWidth: 10 };
  }
  if (/item.*name/i.test(address)) {
    return { text: "<item name>", maxWidth: 12 };
  }
  if (/trainer.*name/i.test(address)) {
    return { text: "<trainer name>", maxWidth: 7 };
  }
  return { text: `<${humanizeVariable(address) || "dynamic text"}>`, maxWidth: null };
}

export function runtimeTextCommandPreview(cleanLine: string): RuntimeTextCommandPreview | null {
  const clean = withoutComment(cleanLine);
  if (!clean) return null;

  const ram = clean.match(/^text_ram\s+([^\s,]+)/i);
  if (ram) {
    const placeholder = ramPlaceholder(ram[1]);
    return {
      kind: "dynamic",
      text: placeholder.text,
      maxWidth: placeholder.maxWidth ?? undefined,
      safeToEdit: placeholder.maxWidth !== null,
    };
  }

  const decimal = clean.match(
    /^text_decimal\s+([^,]+)\s*,\s*([^,]+)\s*,\s*([^\s,]+)/i,
  );
  if (decimal) {
    const digits = parseNumber(decimal[3]);
    return {
      kind: "dynamic",
      text: "<number>",
      maxWidth: digits ?? undefined,
      safeToEdit: digits !== null,
    };
  }

  const bcd = clean.match(/^text_bcd\s+([^,]+)\s*,\s*([^\s,]+)/i);
  if (bcd) {
    return {
      kind: "dynamic",
      text: "<number>",
      safeToEdit: false,
    };
  }

  const dots = clean.match(/^text_dots\s+([^\s,]+)/i);
  if (dots) {
    const count = parseNumber(dots[1]);
    return {
      kind: "dynamic",
      text: count === null ? "<dots>" : "…".repeat(Math.max(0, count)),
      maxWidth: count ?? undefined,
      safeToEdit: count !== null,
    };
  }

  if (/^text_scroll\b/i.test(clean)) {
    return { kind: "break", safeToEdit: true };
  }

  if (
    /^(?:text_start|text_promptbutton|text_waitbutton|text_pause)\b/i.test(clean)
    || /^sound_[A-Za-z0-9_]+\b/i.test(clean)
  ) {
    return { kind: "passthrough", safeToEdit: true };
  }

  return null;
}

export function textPreviewBreakBefore(
  control: TextPreviewControl,
  hasVisibleOutput: boolean,
): "" | "\n" | "\n\n" {
  if (!hasVisibleOutput) return "";
  if (control === "para" || control === "page") return "\n\n";
  if (control === "next" || control === "line" || control === "cont") return "\n";
  return "";
}

export function textBlockPreview(block: string): string | null {
  let result = "";
  let hasVisibleOutput = false;

  for (const line of block.split(/\r?\n/)) {
    const clean = withoutComment(line);
    if (!clean) continue;

    const quoted = clean.match(QUOTED_TEXT_PATTERN);
    if (quoted) {
      const control = quoted[1].toLowerCase() as TextPreviewControl;
      const visible = visibleAsmText(quoted[2]);
      result += textPreviewBreakBefore(control, hasVisibleOutput);
      result += visible;
      hasVisibleOutput = hasVisibleOutput || visible.length > 0;
      continue;
    }

    const runtime = runtimeTextCommandPreview(clean);
    if (!runtime) continue;
    if (runtime.kind === "break") {
      if (hasVisibleOutput && !result.endsWith("\n")) result += "\n";
      continue;
    }
    if (runtime.kind === "dynamic" && runtime.text) {
      result += runtime.text;
      hasVisibleOutput = true;
    }
  }

  return result.trim() || null;
}
