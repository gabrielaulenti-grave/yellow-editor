import { parseItems } from "./itemParsing";
import { parseMapIndex } from "./mapVisualization";
import { parseMoves, parsePokemonIndex } from "./parsers";
import { parseTrainerBaseCatalog } from "./trainerBaseIndex";
import type {
  ProjectSemanticDomain,
  ProjectSemanticDomainCatalog,
  ProjectSemanticDomainOption,
  ProjectSource,
} from "./types";

function uniqueOptions(
  options: ProjectSemanticDomainOption[],
): ProjectSemanticDomainOption[] {
  const byValue = new Map<string, ProjectSemanticDomainOption>();
  for (const option of options) {
    if (!byValue.has(option.value)) {
      byValue.set(option.value, option);
    }
  }
  return [...byValue.values()].sort(
    (left, right) => left.label.localeCompare(right.label)
      || left.value.localeCompare(right.value),
  );
}

function domain(
  id: ProjectSemanticDomain["id"],
  label: string,
  kind: ProjectSemanticDomain["kind"],
  options: ProjectSemanticDomainOption[],
): ProjectSemanticDomain {
  return {
    id,
    label,
    kind,
    sourcePath: null,
    options: uniqueOptions(options),
  };
}

export async function loadProjectSemanticDomains(
  source: ProjectSource,
  projectName: string,
): Promise<ProjectSemanticDomainCatalog> {
  const [
    pokemonResult,
    movesResult,
    itemsResult,
    mapsResult,
    trainersResult,
  ] = await Promise.allSettled([
    parsePokemonIndex(source),
    parseMoves(source),
    parseItems(source),
    parseMapIndex(source),
    parseTrainerBaseCatalog(source, projectName),
  ]);

  const domains: ProjectSemanticDomain[] = [];
  const warnings: string[] = [];

  if (pokemonResult.status === "fulfilled") {
    domains.push(domain(
      "pokemon",
      "Pokémon",
      "pokemon",
      pokemonResult.value
        .filter((entry) => entry.constant)
        .map((entry) => ({
          value: entry.constant as string,
          label: entry.displayName,
        })),
    ));
  } else {
    warnings.push(`Pokémon domain unavailable: ${String(pokemonResult.reason)}`);
  }

  if (movesResult.status === "fulfilled") {
    domains.push(domain(
      "moves",
      "Moves",
      "move",
      movesResult.value.map((entry) => ({
        value: entry.constant,
        label: entry.name,
      })),
    ));
  } else {
    warnings.push(`Move domain unavailable: ${String(movesResult.reason)}`);
  }

  if (itemsResult.status === "fulfilled") {
    domains.push(domain(
      "items",
      "Items",
      "item",
      itemsResult.value.map((entry) => ({
        value: entry.constant,
        label: entry.name,
      })),
    ));
  } else {
    warnings.push(`Item domain unavailable: ${String(itemsResult.reason)}`);
  }

  if (mapsResult.status === "fulfilled") {
    domains.push(domain(
      "maps",
      "Maps",
      "map",
      mapsResult.value.map((entry) => ({
        value: entry.constant,
        label: entry.displayName,
      })),
    ));
  } else {
    warnings.push(`Map domain unavailable: ${String(mapsResult.reason)}`);
  }

  if (trainersResult.status === "fulfilled") {
    domains.push(domain(
      "trainer-classes",
      "Trainer classes",
      "trainer-class",
      trainersResult.value.classes.map((entry) => ({
        value: entry.constant,
        label: entry.name,
      })),
    ));
  } else {
    warnings.push(`Trainer-class domain unavailable: ${String(trainersResult.reason)}`);
  }

  return {
    domains: domains.filter((entry) => entry.options.length > 0),
    warnings,
  };
}
