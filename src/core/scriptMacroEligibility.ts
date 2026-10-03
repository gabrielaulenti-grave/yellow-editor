import type {
  MacroCatalog,
  ScriptMacroCall,
  MacroParameterSummary,
} from "./types";
import { evaluateRgbdsExpression } from "./projectConstants";

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

export function scriptMacroByteExpressionsValid(catalog: MacroCatalog, call: ScriptMacroCall, values: string[], numericConstants?: Map<string, number>): boolean {
  const expressions = definitionFor(catalog, call.name)?.byteExpressions ?? [];
  if (expressions.length === 0) return true;
  const constants = numericConstants ?? new Map(Object.entries(catalog.numericConstants ?? {}));
  for (const constraint of expressions) {
    const references = [...constraint.expression.matchAll(/\\([1-9])/g)].map((match) => Number(match[1]));
    // The source's optional relative expression is inactive without that argument.
    if (references.some((index) => values[index - 1] === undefined)) continue;
    const destination = constraint.destination.replace(/\\([1-9])/g, (_, index) => values[Number(index) - 1] ?? "");
    if (!/^[abcdehl]$/i.test(destination)) continue;
    const expression = constraint.expression.replace(/\\([1-9])/g, (_, index) => `(${values[Number(index) - 1]})`);
    const result = evaluateRgbdsExpression(expression, constants);
    if (result === null || result < 0 || result > 255 || !Number.isInteger(result)) return false;
  }
  return true;
}

export function scriptMacroReadOnlyReason(parameter?: MacroParameterSummary): string | null {
  switch (parameter?.sourceRole) {
    case "symbol-definition": return "This argument declares a symbol. Renaming it requires updating its references.";
    case "routine-target": return "This argument chooses the called routine. Changing it requires verifying the routine's inputs and behavior.";
    case "structural-reference": return "This argument belongs to a declaration or pointer table. Changing it requires a structural edit.";
    case "computed-symbol": return "This argument selects a symbol constructed by the macro. Its target is not proven interchangeable.";
    case "assembly-control": return "This argument controls assembly or a reused address. Changing it requires verifying the surrounding code.";
    default: return null;
  }
}

export function editableScriptMacroArguments(
  catalog: MacroCatalog,
  call: ScriptMacroCall,
): ScriptMacroEditableArgument[] {
  const definition = definitionFor(catalog, call.name);
  const result: ScriptMacroEditableArgument[] = [];

  for (let index = 1; index <= call.arguments.length; index += 1) {
    const parameter = definition?.parameters[index - 1];
    if (parameter?.sourceRole && parameter.sourceRole !== "value") continue;
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

    const constants = parameter?.preserveAddressDivisors?.length || parameter?.preserveRemainders?.length || definition?.byteExpressions?.length
      ? new Map(Object.entries(catalog.numericConstants ?? {})) : null;
    const originalNumber = constants ? evaluateRgbdsExpression(argument.raw, constants) : null;
    const allowedValues = domains[0].options
      .map((option) => option.value)
      .filter((value) =>
        domains.every((domain) =>
          domain.options.some((option) => option.value === value)
        )
      )
      .filter((value) => {
        if (catalog.numericConstants && domains.some((domain) => domain.kind === "constant-family")
          && !Number.isFinite(catalog.numericConstants[value])) return false;
        if (argument.inferredKind === "label" || domains.some((domain) => domain.kind === "label-family")) {
          const signature = catalog.labelSignatures?.[argument.raw];
          if (value !== argument.raw && (!signature || signature === "executable" || signature === "unknown" || catalog.labelSignatures?.[value] !== signature)) return false;
        }
        const nextNumber = constants ? evaluateRgbdsExpression(value, constants) : null;
        if (parameter?.preserveAddressDivisors?.length && !(originalNumber !== null && nextNumber !== null
          && parameter.preserveAddressDivisors.every((divisor) =>
            Math.floor(originalNumber / divisor) === Math.floor(nextNumber / divisor)
          ))) return false;
        if (parameter?.preserveRemainders?.length && !(originalNumber !== null && nextNumber !== null
          && parameter.preserveRemainders.every((divisor) => originalNumber % divisor === nextNumber % divisor))) return false;
        const arguments_ = call.arguments.map((argument) => argument.raw);
        arguments_[index - 1] = value;
        return scriptMacroByteExpressionsValid(catalog, call, arguments_, constants ?? undefined);
      });
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
