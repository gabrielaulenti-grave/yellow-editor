export interface Gen1DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface Gen1TileConversionOptions {
  depth: 1 | 2;
  columnMajor?: boolean;
}

function dmgIndex(red: number, depth: 1 | 2): number {
  // RGBDS 1.0.3's default `--colors dmg` mapping. PNG brightness is inverted
  // into Game Boy shade order, binned into four DMG shades, then reduced to
  // the active 1bpp/2bpp palette size.
  const fourShadeIndex = Math.floor(((255 - red) * 4) / 256);
  const colorsPerPalette = 1 << depth;
  return Math.floor((fourShadeIndex * colorsPerPalette) / 4);
}

function validateImage(image: Gen1DecodedImage, depth: 1 | 2): void {
  const { width, height, rgba } = image;
  if (
    width <= 0 ||
    height <= 0 ||
    width % 8 !== 0 ||
    height % 8 !== 0 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error(
      "PNG width and height must be nonzero multiples of 8 pixels with a complete RGBA buffer.",
    );
  }

  const maxColors = 1 << depth;
  const reducedGrays = new Set<number>();
  const usedBins = new Set<number>();

  for (let offset = 0; offset < rgba.length; offset += 4) {
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const alpha = rgba[offset + 3];

    if (alpha < 0xf0) {
      throw new Error(
        alpha < 0x10
          ? "DMG palette input may not contain transparent pixels."
          : "PNG contains a pixel whose alpha is neither transparent nor opaque.",
      );
    }
    if (red !== green || green !== blue) {
      throw new Error(
        "Image is not compatible with a DMG palette: it contains a non-gray color.",
      );
    }

    // RGBDS reduces PNG colors to RGB555 before deciding how many distinct
    // colors are present. For grayscale input the reduced channel is enough to
    // reproduce the same uniqueness and bin-conflict checks.
    const reduced = red >> 3;
    if (!reducedGrays.has(reduced)) {
      reducedGrays.add(reduced);
      if (reducedGrays.size > maxColors) {
        throw new Error(
          "Image is not compatible with a DMG palette: it contains too many colors.",
        );
      }
      const bin = dmgIndex(red, depth);
      if (usedBins.has(bin)) {
        throw new Error(
          "Image is not compatible with a DMG palette: two colors reduce to the same gray shade.",
        );
      }
      usedBins.add(bin);
    }
  }
}

function appendTile(
  output: number[],
  image: Gen1DecodedImage,
  tileX: number,
  tileY: number,
  depth: 1 | 2,
): void {
  for (let y = 0; y < 8; y += 1) {
    let lowPlane = 0;
    let highPlane = 0;
    for (let x = 0; x < 8; x += 1) {
      const offset = ((tileY + y) * image.width + tileX + x) * 4;
      const index = dmgIndex(image.rgba[offset], depth);
      lowPlane = (lowPlane << 1) | (index & 1);
      highPlane = (highPlane << 1) | ((index >> 1) & 1);
    }
    output.push(lowPlane);
    if (depth === 2) {
      output.push(highPlane);
    }
  }
}

export function encodeGen1RgbaToTiles(
  image: Gen1DecodedImage,
  options: Gen1TileConversionOptions,
): Uint8Array {
  validateImage(image, options.depth);

  const output: number[] = [];
  if (options.columnMajor) {
    // RGBDS --columns advances down each tile column before moving right.
    for (let tileX = 0; tileX < image.width; tileX += 8) {
      for (let tileY = 0; tileY < image.height; tileY += 8) {
        appendTile(output, image, tileX, tileY, options.depth);
      }
    }
  } else {
    for (let tileY = 0; tileY < image.height; tileY += 8) {
      for (let tileX = 0; tileX < image.width; tileX += 8) {
        appendTile(output, image, tileX, tileY, options.depth);
      }
    }
  }

  return Uint8Array.from(output);
}

function canvasPixels(bitmap: ImageBitmap): Uint8ClampedArray {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("The browser could not create a 2D canvas for PNG decoding.");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("The browser could not create a 2D canvas for PNG decoding.");
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  }

  throw new Error("This browser does not provide a canvas API for PNG decoding.");
}

async function decodePng(pngBytes: Uint8Array): Promise<Gen1DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error(
      "This browser does not provide createImageBitmap(), which Yellow Editor needs to decode source PNG graphics.",
    );
  }

  // Copy the requested byte window into a standalone ArrayBuffer so Blob never
  // sees unrelated bytes from a larger backing buffer.
  const copy = Uint8Array.from(pngBytes);
  const blob = new Blob([copy.buffer], { type: "image/png" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
  } catch {
    // Older WebViews may implement createImageBitmap but not all options. The
    // Gen I source PNGs are grayscale, so the default color conversion path is
    // still safe as a compatibility fallback.
    bitmap = await createImageBitmap(blob);
  }

  try {
    const rgba = canvasPixels(bitmap);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: new Uint8ClampedArray(rgba),
    };
  } finally {
    bitmap.close();
  }
}

export async function convertGen1PngToTiles(
  pngBytes: Uint8Array,
  options: Gen1TileConversionOptions,
): Promise<Uint8Array> {
  return encodeGen1RgbaToTiles(await decodePng(pngBytes), options);
}
