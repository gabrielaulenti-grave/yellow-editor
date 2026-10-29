import { encodeGen1RgbaToTiles, type Gen1DecodedImage } from "./gen1Graphics";

export interface GraphicsPixels {
  width: number;
  height: number;
  depth: 1 | 2;
  pixels: number[];
}
export interface PixelRect { x: number; y: number; width: number; height: number }

export function validateGraphicsPngHeader(bytes: Uint8Array): void {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) throw new Error("Invalid PNG source.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width % 8 || height % 8 || width * height > 1024 * 1024) throw new Error("Graphics require complete 8-pixel tiles, up to 4096 pixels per side and one million pixels.");
}

export function validateGraphicsPixels(image: GraphicsPixels): void {
  if (![1, 2].includes(image.depth) || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 8 || image.height < 8 || image.width > 4096 || image.height > 4096 || image.width % 8 || image.height % 8
    || image.width * image.height > 1024 * 1024 || image.pixels.length !== image.width * image.height
    || image.pixels.some(pixel => !Number.isInteger(pixel) || pixel < 0 || pixel >= 1 << image.depth)) {
    throw new Error("Graphics require complete 8-pixel tiles and valid shade indices, up to one million pixels.");
  }
}

export function graphicsPixelsFromImage(image: Gen1DecodedImage, depth: 1 | 2): GraphicsPixels {
  if (image.width * image.height > 1024 * 1024) throw new Error("This graphic is too large for the pixel editor.");
  // Use the build converter's validation and shade reduction, including 1bpp.
  encodeGen1RgbaToTiles(image, { depth });
  return { width: image.width, height: image.height, depth,
    pixels: Array.from({ length: image.width * image.height }, (_, i) => Math.floor(Math.floor((255 - image.rgba[i * 4]) * 4 / 256) * (1 << depth) / 4)) };
}

export function graphicsPixelsToImage(image: GraphicsPixels): Gen1DecodedImage {
  validateGraphicsPixels(image);
  const rgba = new Uint8ClampedArray(image.pixels.length * 4);
  image.pixels.forEach((pixel, i) => {
    const gray = 255 - pixel * (image.depth === 1 ? 255 : 85);
    rgba.set([gray, gray, gray, 255], i * 4);
  });
  return { width: image.width, height: image.height, rgba };
}

export function decodeGraphicsTiles(bytes: Uint8Array, depth: 1 | 2): GraphicsPixels {
  const tileSize = depth * 8, tiles = bytes.length / tileSize;
  if (!Number.isInteger(tiles) || tiles < 1 || tiles > 16384) throw new Error("The raw graphic must contain complete 8×8 tiles.");
  let columns = Math.min(16, tiles);
  while (tiles % columns) columns--;
  const width = columns * 8, height = tiles / columns * 8, pixels = new Array<number>(width * height);
  for (let tile = 0; tile < tiles; tile++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = tile * tileSize + y * depth, bit = 7 - x;
    pixels[(Math.floor(tile / columns) * 8 + y) * width + tile % columns * 8 + x]
      = (bytes[offset] >> bit & 1) + (depth === 2 ? (bytes[offset + 1] >> bit & 1) * 2 : 0);
  }
  return { width, height, depth, pixels };
}

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function uint32(value: number): number[] { return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255]; }
function chunk(type: string, bytes: Uint8Array): Uint8Array {
  const data = Uint8Array.from([...new TextEncoder().encode(type), ...bytes]);
  return Uint8Array.from([...uint32(bytes.length), ...data, ...uint32(pngCrc(data))]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Lossless grayscale PNG, with stored DEFLATE blocks; identical in web and desktop. */
export function encodeGraphicsPng(image: GraphicsPixels): Uint8Array {
  validateGraphicsPixels(image);
  const raw = new Uint8Array((image.width + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    raw[y * (image.width + 1) + 1 + x] = 255 - image.pixels[y * image.width + x] * (image.depth === 1 ? 255 : 85);
  }
  const blocks = [Uint8Array.of(0x78, 0x01)];
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const length = Math.min(65535, raw.length - offset), inverse = length ^ 65535;
    blocks.push(Uint8Array.of(offset + length === raw.length ? 1 : 0, length & 255, length >>> 8, inverse & 255, inverse >>> 8), raw.subarray(offset, offset + length));
  }
  let a = 1, b = 0;
  for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  blocks.push(Uint8Array.from(uint32((b << 16 | a) >>> 0)));
  return concat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", Uint8Array.from([...uint32(image.width), ...uint32(image.height), 8, 0, 0, 0, 0])),
    chunk("IDAT", concat(blocks)), chunk("IEND", new Uint8Array())]);
}

export function drawPixelLine(pixels: number[], width: number, height: number, fromX: number, fromY: number, toX: number, toY: number, shade: number): number[] {
  const next = pixels.slice(), dx = Math.abs(toX - fromX), dy = -Math.abs(toY - fromY);
  const sx = fromX < toX ? 1 : -1, sy = fromY < toY ? 1 : -1;
  let x = fromX, y = fromY, error = dx + dy;
  while (true) {
    if (x >= 0 && y >= 0 && x < width && y < height) next[y * width + x] = shade;
    if (x === toX && y === toY) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return next;
}
export function fillGraphics(pixels: number[], width: number, x: number, y: number, shade: number, rect: PixelRect = { x: 0, y: 0, width, height: pixels.length / width }): number[] {
  const next = pixels.slice(), old = next[y * width + x];
  if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return next;
  if (old === shade) return next;
  const pending = [y * width + x]; next[pending[0]] = shade;
  while (pending.length) {
    const at = pending.pop()!;
    for (const other of [at % width ? at - 1 : -1, at % width < width - 1 ? at + 1 : -1, at - width, at + width]) {
      if (other >= 0 && other < next.length && other % width >= rect.x && other % width < rect.x + rect.width
        && Math.floor(other / width) >= rect.y && Math.floor(other / width) < rect.y + rect.height && next[other] === old) { next[other] = shade; pending.push(other); }
    }
  }
  return next;
}
export function flipGraphics(pixels: number[], width: number, rect: PixelRect, axis: "horizontal" | "vertical"): number[] {
  const next = pixels.slice();
  for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
    next[(rect.y + y) * width + rect.x + x] = pixels[(rect.y + (axis === "vertical" ? rect.height - y - 1 : y)) * width + rect.x + (axis === "horizontal" ? rect.width - x - 1 : x)];
  }
  return next;
}
