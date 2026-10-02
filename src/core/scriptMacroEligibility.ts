import type {
  MacroCatalog,
  ScriptMacroCall,
} from "./types";

export interface ScriptMacroEditableArgument {
  index: number;
  domainIds: string[];
  allowedValues: string[];
}

function definitionFor(catalog: MacroCatalog, macroName: string) {
  return catalog.macros.find(
    (definition) => definition.name.toLowerCase() === macroName.toLowerCase(),
  ) ?? null;
}

export function editableScriptMacroArguments(
  catalog: MacroCatalog,
  call: ScriptMacroCall,
): ScriptMacroEditableArgument[] {
  const definition = definitionFor(catalog, call.name);
  const wrapperTargetLocked = ["callfar", "farjp", "predef_jump"].includes(
    call.name.toLowerCase(),
  );
  const result: ScriptMacroEditableArgument[] = [];

  for (let index = 1; index <= call.arguments.length; index += 1) {
    if (wrapperTargetLocked && index === 1) continue;

    const parameter = definition?.parameters[index - 1];
    const argument = call.arguments[index - 1];
    if (!argument) continue;

    const domainIds = [...new Set([
      ...(parameter?.semanticDomains.map((domain) => domain.domainId) ?? []),
      ...argument.semanticDomains.map((domain) => domain.domainId),
    ])].filter((domainId) => {
      const domain = catalog.domains.find((candidate) => candidate.id === domainId);
      return Boolean(
        domain?.options.some((option) => option.value === argument.raw),
      );
    });
    if (domainIds.length === 0) continue;

    const domains = domainIds
      .map((domainId) => catalog.domains.find((domain) => domain.id === domainId))
      .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));
    if (domains.length !== domainIds.length || domains.length === 0) continue;

    const allowedValues = domains[0].options
      .map((option) => option.value)
      .filter((value) =>
        domains.every((domain) =>
          domain.options.some((option) => option.value === value)
        )
      );
    if (!allowedValues.includes(argument.raw)) continue;

    result.push({
      index,
      domainIds,
      allowedValues,
    });
  }

  return result;
}

export function scriptMacroHasEditableAlternative(
  catalog: MacroCatalog,
  call: ScriptMacroCall,
): boolean {
  return editableScriptMacroArguments(catalog, call).some((entry) => {
    const current = call.arguments[entry.index - 1]?.raw;
    return entry.allowedValues.some((value) => value !== current);
  });
}
