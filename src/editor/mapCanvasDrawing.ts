import type { MapVisualization } from "../core/types";

const SHADE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [248, 248, 248],
  [168, 168, 168],
  [88, 88, 88],
  [16, 16, 16],
];

function tileShade(bytes: number[], tileId: number, x: number, y: number): number {
  const offset = tileId * 16 + y * 2;
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) return 0;
  const bit = 7 - x;
  return ((high >> bit) & 1) * 2 + ((low >> bit) & 1);
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  shade: number,
) {
  const rgb = SHADE_RGB[shade] ?? SHADE_RGB[0];
  const offset = (y * width + x) * 4;
  data[offset] = rgb[0];
  data[offset + 1] = rgb[1];
  data[offset + 2] = rgb[2];
  data[offset + 3] = 255;
}

function drawTileIntoImage(
  image: ImageData,
  gfx: number[],
  tileId: number,
  targetX: number,
  targetY: number,
) {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      setPixel(
        image.data,
        image.width,
        targetX + x,
        targetY + y,
        tileShade(gfx, tileId, x, y),
      );
    }
  }
}

export function renderTiles(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
) {
  const columns = 16;
  const rows = Math.max(1, Math.ceil(visualization.tileCount / columns));
  canvas.width = columns * 8;
  canvas.height = rows * 8;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(canvas.width, canvas.height);
  for (let tileId = 0; tileId < visualization.tileCount; tileId += 1) {
    drawTileIntoImage(
      image,
      visualization.tilesetGfx,
      tileId,
      (tileId % columns) * 8,
      Math.floor(tileId / columns) * 8,
    );
  }
  context.putImageData(image, 0, 0);
}

export function renderBlocks(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
) {
  const columns = 8;
  const rows = Math.max(1, Math.ceil(visualization.blockCount / columns));
  canvas.width = columns * 32;
  canvas.height = rows * 32;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(canvas.width, canvas.height);
  for (let blockId = 0; blockId < visualization.blockCount; blockId += 1) {
    const blockX = (blockId % columns) * 32;
    const blockY = Math.floor(blockId / columns) * 32;
    const blockOffset = blockId * 16;

    for (let tileY = 0; tileY < 4; tileY += 1) {
      for (let tileX = 0; tileX < 4; tileX += 1) {
        const tileId = visualization.blockset[blockOffset + tileY * 4 + tileX];
        if (tileId === undefined) continue;
        drawTileIntoImage(
          image,
          visualization.tilesetGfx,
          tileId,
          blockX + tileX * 8,
          blockY + tileY * 8,
        );
      }
    }
  }
  context.putImageData(image, 0, 0);
}

export function renderMap(
  canvas: HTMLCanvasElement,
  visualization: MapVisualization,
  showGrid: boolean,
  gridSize = 32,
) {
  const width = visualization.map.width * 32;
  const height = visualization.map.height * 32;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(width, height);
  for (let blockY = 0; blockY < visualization.map.height; blockY += 1) {
    for (let blockX = 0; blockX < visualization.map.width; blockX += 1) {
      const mapIndex = blockY * visualization.map.width + blockX;
      const blockId = visualization.mapBlocks[mapIndex];
      const blockOffset = blockId === undefined ? -1 : blockId * 16;

      for (let tileY = 0; tileY < 4; tileY += 1) {
        for (let tileX = 0; tileX < 4; tileX += 1) {
          const tileId = blockOffset < 0
            ? undefined
            : visualization.blockset[blockOffset + tileY * 4 + tileX];

          for (let pixelY = 0; pixelY < 8; pixelY += 1) {
            for (let pixelX = 0; pixelX < 8; pixelX += 1) {
              const targetX = blockX * 32 + tileX * 8 + pixelX;
              const targetY = blockY * 32 + tileY * 8 + pixelY;
              const shade = tileId === undefined
                ? ((pixelX + pixelY) % 2 === 0 ? 1 : 2)
                : tileShade(
                    visualization.tilesetGfx,
                    tileId,
                    pixelX,
                    pixelY,
                  );
              setPixel(image.data, width, targetX, targetY, shade);
            }
          }
        }
      }
    }
  }
  context.putImageData(image, 0, 0);

  if (showGrid) {
    context.save();
    context.strokeStyle = "rgba(0, 0, 0, 0.34)";
    context.lineWidth = 1;
    for (let x = gridSize; x < width; x += gridSize) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
    for (let y = gridSize; y < height; y += gridSize) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
    }
    context.restore();
  }
}

