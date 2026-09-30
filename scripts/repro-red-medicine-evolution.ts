import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVOLUTION_ENGINE_PATH,
  ITEM_EFFECTS_PATH,
  POKEMON_DATA_CONSTANTS_PATH,
  installMoveEvolutionSupport,
} from "../src/core/evolutionExtensions";
import { syncMedicineEvolutionHooks } from "../src/core/itemEvolutionHooks";

const root = process.argv[2];
if (!root) {
  throw new Error("Usage: repro-red-medicine-evolution <pokered checkout>");
}

const read = (path: string) => readFileSync(join(root, path), "utf8");
const write = (path: string, contents: string) =>
  writeFileSync(join(root, path), contents, "utf8");

const evosPath = "data/pokemon/evos_moves.asm";
const itemConstantsPath = "constants/item_constants.asm";

let evos = read(evosPath);
const originalBulbasaur =
  "BulbasaurEvosMoves:\n; Evolutions\n\tdb EVOLVE_LEVEL, 16, IVYSAUR";
if (!evos.includes(originalBulbasaur)) {
  throw new Error("The pinned pokered checkout no longer has the expected Bulbasaur evolution block.");
}
evos = evos.replace(
  originalBulbasaur,
  "BulbasaurEvosMoves:\n; Evolutions\n\tdb EVOLVE_ITEM, POTION, 1, IVYSAUR",
);

const installed = installMoveEvolutionSupport(
  read(POKEMON_DATA_CONSTANTS_PATH),
  read(EVOLUTION_ENGINE_PATH),
  read(ITEM_EFFECTS_PATH),
);
const itemEffects = syncMedicineEvolutionHooks(
  evos,
  read(itemConstantsPath),
  installed.itemEffects,
);

write(evosPath, evos);
write(POKEMON_DATA_CONSTANTS_PATH, installed.constants);
write(EVOLUTION_ENGINE_PATH, installed.evolutionEngine);
write(ITEM_EFFECTS_PATH, itemEffects);

console.log("Applied Yellow Editor medicine-evolution patch to pinned pret/pokered.");
