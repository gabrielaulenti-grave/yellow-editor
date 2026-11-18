// Read-only, conservative short-horizon landing estimator for Pokémon Yellow.
// This does NOT simulate future RNG, modify the ROM, or claim to know terrain
// outside the current generated 20-height / 12-tile lookahead.
//
// Original ROM (SurfingMinigame_UpdatePikachuHeight) stores (Y << 8) |
// FieldC, updates a fixed-point velocity by +/- 0x80, and applies
// +/- 4 * floor(velocity / 256)^2 each frame. The contact test happens at
// the START of each descending update, before vertical motion.
const CONTACT_X = 72;
const SCROLL_PIXELS_PER_FRAME = 1.5;
const MAX_FRAMES = 58;
const UNKNOWN = Object.freeze({ known: false, frames: null, offset: null, tile: null, safety: null });

function contactAt(state, frames) {
  const forward = frames * SCROLL_PIXELS_PER_FRAME;
  const scroll = state.scroll & 0xff;
  const waveIndex = Math.floor(((scroll & 15) + CONTACT_X + forward) / 8) - 2;
  const tileIndex = Math.floor(((scroll & 7) + forward) / 8);
  if (waveIndex < 0 || waveIndex >= state.waveHeights?.length ||
      tileIndex < 0 || tileIndex >= state.terrainTiles?.length) return null;
  const tile = state.terrainTiles[tileIndex];
  const base = state.waveHeights[waveIndex];
  if (!Number.isInteger(tile) || tile === 255 || !Number.isInteger(base) ||
      base < 0 || base > 143) return null;
  const phase = (scroll + CONTACT_X + forward) % 8;
  // Exactly as SurfingMinigame_SetPikachuHeight: rising/crest are
  // subtracted, falling adds the pixel phase, flat uses the raw height.
  const height = tile === 6 || tile === 20 ? base - phase : tile === 7 ? base + phase : base;
  if (height < 0 || height >= 144) return null;
  return { tile, height, offset: forward };
}

export function landingSafety(tile, frameset) {
  if (!Number.isInteger(tile) || !Number.isInteger(frameset)) return null;
  // 3 clean; 2 rough; 1 hard; 0 wipeout, exactly following
  // SurfingMinigame_TileInteraction for the tile IDs below.
  const flat = [0,0,1,2,3,2,1,0];
  const rising = [0,0,0,0,1,2,3,2];
  const falling = [0,2,3,2,1,0,0,0];
  const crest = [0,0,1,2,3,3,2,1];
  const table = tile === 6 ? rising : tile === 7 ? falling :
    tile === 18 || tile === 20 ? crest : flat;
  return table[frameset] ?? 0;
}

export function predictLanding(state) {
  if (state?.state !== 1 ||
      !Number.isInteger(state.rawY) || !Number.isInteger(state.yFraction) ||
      !Number.isInteger(state.jumpMagnitude) || !Number.isInteger(state.jumpFraction) ||
      (state.descending !== 0 && state.descending !== 1) ||
      !Number.isInteger(state.scroll)) return UNKNOWN;
  let position = ((state.rawY << 8) | state.yFraction) & 0xffff;
  let velocity = ((state.jumpMagnitude << 8) | state.jumpFraction) & 0xffff;
  let descending = state.descending === 1;

  for (let frame = 1; frame <= MAX_FRAMES; frame++) {
    const contact = contactAt(state, frame);
    if (!contact) return UNKNOWN;
    const y = position >>> 8;
    if (descending && y < 144 && y >= contact.height) {
      return {
        known: true, frames: frame, offset: contact.offset,
        tile: contact.tile, safety: landingSafety(contact.tile, state.angle),
      };
    }
    if (!descending) {
      if (velocity === 0) { descending = true; continue; }
      velocity = (velocity - 0x80) & 0xffff;
      const magnitude = velocity >>> 8;
      position = (position - 4 * magnitude * magnitude) & 0xffff;
    } else {
      velocity = (velocity + 0x80) & 0xffff;
      const magnitude = velocity >>> 8;
      position = (position + 4 * magnitude * magnitude) & 0xffff;
    }
  }
  return UNKNOWN;
}

export function landingFeatures(prediction) {
  if (!prediction?.known) return Array(8).fill(0);
  return [
    1,
    Math.min(1, prediction.frames / MAX_FRAMES),
    Math.min(1, prediction.offset / (MAX_FRAMES * SCROLL_PIXELS_PER_FRAME)),
    ...[6, 20, 18, 7].map(tile => +(prediction.tile === tile)),
    prediction.safety === null ? 0 : (prediction.safety - 1.5) / 1.5,
  ];
}
