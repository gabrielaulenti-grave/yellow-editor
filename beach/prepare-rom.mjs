import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.argv.length !== 3) {
  console.error("Usage: node beach/prepare-rom.mjs /path/to/a/separate/pokeyellow-checkout");
  process.exit(1);
}

const root = resolve(process.argv[2]);
const initPath = resolve(root, "home/init.asm");
const gamePath = resolve(root, "engine/minigame/surfing_pikachu.asm");
const [init, game] = await Promise.all([readFile(initPath, "utf8"), readFile(gamePath, "utf8")]);

function replaceOnce(source, original, replacement) {
  const start = source.indexOf(original);
  if (start === -1 || source.indexOf(original, start + original.length) !== -1) {
    throw new Error("Unrecognized pokeyellow source. Use the revision in beach/README.md.");
  }
  return source.slice(0, start) + replacement + source.slice(start + original.length);
}

if (init.includes("BeachTrainerSignature::") && !game.includes("call ReloadMapAfterSurfingMinigame")) {
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

await writeFile(gamePath, patchedGame);
try {
  await writeFile(initPath, patchedInit);
} catch (error) {
  await writeFile(gamePath, game);
  throw error;
}
console.log("Patched the checkout. Build Pokémon Yellow in Yellow Editor and download its ROM and .sym file.");
