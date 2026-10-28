// Source-only mutations made independently of Yellow Editor's generators.
export function importedMapObjectFixture(input: Record<string, string>): Record<string, string> {
  const files = Object.fromEntries(Object.entries(input).map(([path, text]) => [path, text.replace(/\bMT_MOON_1F\b/g, "IMPORTED_CAVE").replace(/TEXT_MTMOON1F_/g, "IMPORTED_TEXT_").replace(/\bPickUpItemText\b/g, "ImportedTreasureHandler").replace(/\bMtMoon1TrainerHeader0\b/g, "ImportedFirstHeader")]));
  const patch = (p: string, fn: (s: string) => string) => { files[p] = fn(files[p]); };
  files["constants/imported_test.asm"] = "DEF IMPORTED_X EQU 4\nDEF IMPORTED_PARTY EQU 0\nDEF IMPORTED_OPPONENT EQU OPP_HIKER\nDEF IMPORTED_RANGE EQU 1\n";
  files["constants/imported_dimensions.asm"] = "DEF IMPORTED_WIDTH EQU 20\n";
  patch("includes.asm", s => s.replace('INCLUDE "constants/map_constants.asm"', 'INCLUDE "constants/imported_dimensions.asm"\nINCLUDE "constants/map_constants.asm"') + '\nINCLUDE "constants/imported_test.asm"\n');
  patch("constants/map_constants.asm", s => s.replace(/(map_const IMPORTED_CAVE,\s*)20/, "$1IMPORTED_WIDTH"));
  patch("data/maps/objects/MtMoon1F.asm", s => s.replace("object_event  5,  6,", "object_event IMPORTED_X + 1, $06,").replace("IMPORTED_TEXT_HIKER, OPP_HIKER, 1", "IMPORTED_TEXT_HIKER, IMPORTED_OPPONENT, IMPORTED_PARTY + 1"));
  patch("data/sprites/sprites.asm", s => s.split(/\r?\n/).map(l => l.split(";")[0]).join("\n"));
  patch("engine/overworld/map_sprites.asm", s => s.replace(/^(\w+:{1,2}\n)/m, "$1\tnop ; unrelated hack customization\n"));
  patch("macros/scripts/maps.asm", s => s.replace("db \\2 + 4", "db (4 + \\2)"));
  const path = "scripts/MtMoon1F.asm", header = files[path].match(/^ImportedFirstHeader:\n\ttrainer[^\n]+\n/m)![0];
  files["scripts/imported/first_header.asm"] = header.replace(/, 2,/, ", IMPORTED_RANGE + 1,");
  files["scripts/imported/helpers.asm"] = "ImportedTrainerHelper::\n\tld hl, ImportedFirstHeader\n\tjp TalkToTrainer\n";
  patch(path, s => s.replace(header, 'INCLUDE "scripts/imported/first_header.asm"\n').replace(/MtMoon1FHikerText:\n[\s\S]*?(?=\nMtMoon1FYoungster1Text:)/, "MtMoon1FHikerText:\n\ttext_asm\n\tCheckEvent EVENT_BEAT_MT_MOON_1_TRAINER_0\n\tjr nz, .other\n\tfarcall ImportedTrainerHelper\n\tjp TextScriptEnd\n.other\n\tfarcall ImportedTrainerHelper\n\tjp TextScriptEnd\n") + '\nINCLUDE "scripts/imported/helpers.asm"\n');
  // Names of opponent aliases and the saved flag array are not ABI semantics.
  for (const path of Object.keys(files)) files[path] = files[path].replace(/\bOPP_/g, "BATTLE_").replace(/\bwEventFlags\b/g, "wAdventureEvents");
  return files;
}
