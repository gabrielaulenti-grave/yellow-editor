import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.argv.length !== 3) {
  console.error("Usage: node beach/prepare-rom.mjs /path/to/a/separate/pokeyellow-checkout");
  process.exit(1);
}

const root = resolve(process.argv[2]);
const initPath = resolve(root, "home/init.asm");
const gamePath = resolve(root, "engine/minigame/surfing_pikachu.asm");
const ramPath = resolve(root, "ram/wram.asm");
const [init, game, ram] = await Promise.all([readFile(initPath, "utf8"), readFile(gamePath, "utf8"), readFile(ramPath, "utf8")]);

function replaceOnce(source, original, replacement) {
  const start = source.indexOf(original);
  if (start === -1 || source.indexOf(original, start + original.length) !== -1) {
    throw new Error("Unrecognized pokeyellow source. Use the revision in beach/README.md.");
  }
  return source.slice(0, start) + replacement + source.slice(start + original.length);
}

if (init.includes("BeachTrainerSignature::") && game.includes("wBeachTrainerLastLandingQuality") && ram.includes("wBeachTrainerLastLandingQuality::")) {
  console.log("The checkout already has the Pikachu’s Beach boot patch.");
  process.exit(0);
}

const patchedInit = replaceOnce(init, `	predef PlayIntro

	call DisableLCD
	call ClearVram
	call GBPalNormal
	call ClearSprites
	ld a, LCDC_DEFAULT
	ldh [rLCDC], a

	jp PrepareTitleScreen`, `	; Keep the original results-screen cries by supplying the starter
	; species, Surf, and the end-of-party marker. Init zeroed both OT IDs.
	ld hl, wPartyCount
	ld [hl], 1
	inc hl
	ld [hl], STARTER
	inc hl
	ld [hl], $ff
	ld a, SURF
	ld [wPartyMon1Moves], a

.playBeach
	farcall SurfingPikachuMinigame
	ld hl, wPikachuMapScriptFlags
	set BIT_PIKACHU_MAP_SURF_SELECT, [hl]
	jr .playBeach

BeachTrainerSignature::
	db $50, $42, $45, $41, $43, $48, $31 ; ASCII "PBEACH1"`);

const patchedGame = replaceOnce(game,
  "\tcall ReloadMapAfterSurfingMinigame\n\tcall PlayDefaultMusic\n\tcall GBPalNormal\n",
  "");

// Reserve one byte in the minigame's existing WRAM union. The same buffer
// is cleared on minigame startup, and each jump additionally resets the byte.
const patchedRam=replaceOnce(ram,
  "wSurfingMinigameIntroAnimationFinished:: db",
  "wSurfingMinigameIntroAnimationFinished:: db\n" +
  "wBeachTrainerLastLandingQuality:: db ; 0=none, 1=clean, 2=rough, 3=hard, 4=wipeout");
let instrumentedGame=replaceOnce(patchedGame,
  "\tld [wSurfingMinigameTrickFlags], a\n\txor a",
  "\tld [wSurfingMinigameTrickFlags], a\n\tld [wBeachTrainerLastLandingQuality], a\n\txor a");
instrumentedGame=replaceOnce(instrumentedGame,
  ".hardLanding\n\tcall SurfingMinigame_ReduceSpeedBy128\n\tjr .cleanLanding\n\n.roughLanding\n\tcall SurfingMinigame_ReduceSpeedBy64\n.cleanLanding",
  ".hardLanding\n\tld a, 3\n\tld [wBeachTrainerLastLandingQuality], a\n\tcall SurfingMinigame_ReduceSpeedBy128\n\tjr .landingSound\n\n.roughLanding\n\tld a, 2\n\tld [wBeachTrainerLastLandingQuality], a\n\tcall SurfingMinigame_ReduceSpeedBy64\n\tjr .landingSound\n.cleanLanding\n\tld a, 1\n\tld [wBeachTrainerLastLandingQuality], a\n.landingSound");
instrumentedGame=replaceOnce(instrumentedGame,
  ".wipeout\n\tld a, 0.25",
  ".wipeout\n\tld a, 4\n\tld [wBeachTrainerLastLandingQuality], a\n\tld a, 0.25");
// Adding instrumentation lengthens the collision routine; use full JP
// branches there so no upstream short JR silently crosses its 8-bit range.
const collisionStart=instrumentedGame.indexOf("SurfingMinigame_TileInteraction:");
const collisionEnd=instrumentedGame.indexOf("\nSurfingMinigame_SpeedUpPikachu:",collisionStart);
if(collisionStart<0 || collisionEnd<0) throw new Error("Cannot locate collision routine");
const collision=instrumentedGame.slice(collisionStart,collisionEnd)
  .replace(/\tjr (z|nz|c|nc), /g,"\tjp $1, ")
  .replace(/\tjr (\.[A-Za-z][A-Za-z0-9]*)/g,"\tjp $1");
instrumentedGame=instrumentedGame.slice(0,collisionStart)+collision+
  instrumentedGame.slice(collisionEnd);


await writeFile(gamePath, instrumentedGame);
try {
  await writeFile(initPath, patchedInit);
  await writeFile(ramPath, patchedRam);
} catch (error) {
  await writeFile(gamePath, game);
  await writeFile(ramPath, ram);
  throw error;
}
console.log("Patched boot flow and definitive landing-quality telemetry. Build using RGBDS.");
