import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";

export const memoryFields = {
  routine: ["wSurfingMinigameRoutineNumber", 1],
  state: ["wSurfingMinigamePikachuState", 1],
  hp: ["wSurfingMinigamePikachuHP", 2],
  radness: ["wSurfingMinigameRadnessScore", 2],
  trickMeter: ["wSurfingMinigameRadnessMeter", 1],
  trickFlags: ["wSurfingMinigameTrickFlags", 1],
  score: ["wSurfingMinigameTotalScore", 2],
  speed: ["wSurfingMinigamePikachuSpeed", 2],
  distance: ["wSurfingMinigameDistance", 3],
  x: ["wAnimatedObject0XCoord", 1],
  y: ["wAnimatedObject0YCoord", 1],
  yOffset: ["wAnimatedObject0YOffset", 1],
  yFraction: ["wAnimatedObject0FieldC", 1],
  angle: ["wAnimatedObject0FramesetID", 1],
  descending: ["wSurfingMinigameJumpDescending", 1],
  jumpMagnitude: ["wSurfingMinigameJumpArcMagnitude", 1],
  jumpFraction: ["wSurfingMinigameJumpArcFraction", 1],
  groundHeight: ["wSurfingMinigamePikachuObjectHeight", 1],
  surfaceTile: ["wSurfingMinigameBGMapReadBuffer", 1],
  scroll: ["hSCX", 1],
  water: ["wSurfingMinigameWaveHeight", 20],
  terrainTiles: ["__lookahead__", 12],
};
export const frameLength = 160 * 144 * 4;
export const actionNames = ["Release", "Left", "Right"];

export async function openBeach(executable, romPath, symPath) {
  const [rom, source] = await Promise.all([readFile(romPath), readFile(symPath, "utf8")]);
  const symbols = new Map([...source.matchAll(/^([\da-f]+):([\da-f]{4})\s+(\S+)/gim)]
    .map(([, bank, address, label]) => [label, { bank: parseInt(bank, 16), address: parseInt(address, 16) }]));
  const signature = symbols.get("BeachTrainerSignature");
  if (signature?.bank !== 0 || rom.toString("ascii", signature.address, signature.address + 7) !== "PBEACH1") {
    throw new Error("Use the patched Pikachu’s Beach ROM and its matching .sym export.");
  }
  const addresses = [];
  for (const [label, width] of Object.values(memoryFields)) {
    if (label === "__lookahead__") continue;
    const address = symbols.get(label)?.address;
    if (!(address >= 0xc000 && address + width <= 0xffff)) throw new Error(`Missing or invalid symbol ${label}.`);
    for (let i = 0; i < width; i++) addresses.push((address + i).toString(16));
  }
  const scrollAddress = symbols.get("hSCX")?.address;
  const heightsAddress = symbols.get("wSurfingMinigameWaveHeight")?.address;
  if (!(scrollAddress >= 0xc000 && heightsAddress >= 0xc000)) throw new Error("Missing lookahead symbols");
  const terrainArgument = `T${scrollAddress.toString(16)},${heightsAddress.toString(16)}`;
  const sampleBytes = memoryFields.terrainTiles[1];
  const child = spawn(executable, [romPath, ...addresses, terrainArgument], { stdio: ["pipe", "pipe", "inherit"] });
  let request;
  let failure;
  function fail(error) {
    failure ??= error;
    if (request) {
      clearTimeout(request.timer);
      request.reject(failure);
      request = undefined;
    }
    child.kill();
  }
  child.once("error", fail);
  child.once("exit", (code, signal) => fail(new Error(`Emulator exited (${code ?? signal}).`)));
  child.stdin.on("error", fail);
  child.stdout.on("data", (bytes) => {
    if (!request || bytes.length > request.buffer.length - request.offset) {
      fail(new Error("Unexpected emulator response."));
      return;
    }
    bytes.copy(request.buffer, request.offset);
    request.offset += bytes.length;
    if (request.offset !== request.buffer.length) return;
    const { buffer, resolve, timer } = request;
    request = undefined;
    clearTimeout(timer);
    resolve({ state: decode(buffer), pixels: buffer.length > addresses.length + sampleBytes ? buffer.subarray(addresses.length + sampleBytes) : null });
  });
  await once(child, "spawn");

  return {
    id: createHash("sha256").update(rom).update(source).digest("hex"),
    step(action, pixels = false) {
      if (failure) return Promise.reject(failure);
      if (request) return Promise.reject(new Error("Emulator step already in flight."));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error("Emulator frame timed out.")), 5000);
        request = { resolve, reject, timer, buffer: Buffer.allocUnsafe(addresses.length + sampleBytes + (pixels ? frameLength : 0)), offset: 0 };
        child.stdin.write(Buffer.from([action | (pixels ? 4 : 0)]));
      });
    },
    close() { child.stdin.end(); },
  };
}

export function decode(memory) {
  let offset = 0;
  const values = {};
  for (const [key, [, width]] of Object.entries(memoryFields)) {
    values[key] = memory.subarray(offset, offset + width);
    offset += width;
  }
  const byte = (key) => values[key][0];
  const bcd = (key) => {
    const [lo, hi] = values[key];
    return (hi >> 4) * 1000 + (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15);
  };
  return {
    routine: byte("routine"), state: byte("state"), hp: bcd("hp"), radness: bcd("radness"), score: bcd("score"),
    speed: values.speed.readUInt16LE() / 256, progress: Math.min(1, values.distance.readUIntBE(0, 3) / (24 * 65536)),
    x: byte("x") - 8, y: ((byte("y") + byte("yOffset")) & 255) - 16,
    trickMeter: byte("trickMeter"), trickFlags: byte("trickFlags"),
    angle: byte("angle"),
    rawY: byte("y"), yFraction: byte("yFraction"),
    descending: byte("descending"),
    jumpMagnitude: byte("jumpMagnitude"),
    jumpFraction: byte("jumpFraction"),
    groundHeight: byte("groundHeight"),
    // Read the raw animated-object Y coordinate, not the display-only Y offset.
    // Values >=144 are wrapped coordinates when Pikachu is above the viewport.
    // This unsigned modular distance is 0 at contact; it may wrap after contact.
    landingClearance: (byte("groundHeight") - byte("y") + 256) & 255,
    surfaceTile: byte("surfaceTile"),
    scroll: byte("scroll"),
    waveHeights: [...values.water],
    terrainTiles: [...values.terrainTiles],
    // The 20-height buffer starts at tile 2 relative to the aligned viewport.
    // Sample tiles at fixed screen positions; the newest entries can be offscreen.
    water: Array.from({ length: 8 }, (_, i) => values.water[((40 + 16 * i + (byte("scroll") & 15)) >> 3) - 2]),
  };
}
