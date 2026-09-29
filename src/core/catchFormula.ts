import type { BallRoutineParameters } from "./types";

export type Gen1BallKind = "master" | "poke" | "great" | "ultra" | "safari";
export type Gen1CatchStatus = "none" | "minor" | "major";
export type SafariCatchAdjustment = "none" | "bait" | "rock";

export interface Gen1CatchSimulationInput {
  ball: Gen1BallKind;
  catchRate: number;
  maxHp: number;
  currentHp: number;
  status: Gen1CatchStatus;
  safariAdjustment?: SafariCatchAdjustment;
}

export interface Gen1CatchSimulationResult {
  probability: number;
  effectiveCatchRate: number;
  effectiveRandomCeiling: number;
  statusCatchBonus: number;
  hpFactor: number;
  secondRollChance: number;
  automaticFromHpFactor: boolean;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function positiveInt(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function effectiveBallRandomCeiling(
  parameters: BallRoutineParameters,
  ball: Gen1BallKind,
): number {
  switch (ball) {
    case "master":
    case "poke":
      return 255;
    case "great":
      return clampByte(parameters.greatRandomCeiling);
    case "ultra":
    case "safari":
      return Math.min(
        clampByte(parameters.greatRandomCeiling),
        clampByte(parameters.ultraSafariRandomCeiling),
      );
  }
}

export function applySafariCatchAdjustment(
  catchRate: number,
  adjustment: SafariCatchAdjustment,
): number {
  const rate = clampByte(catchRate);
  if (adjustment === "bait") return Math.floor(rate / 2);
  if (adjustment === "rock") return Math.min(255, rate * 2);
  return rate;
}

function statusCatchBonus(
  parameters: BallRoutineParameters,
  status: Gen1CatchStatus,
): number {
  if (status === "minor") return clampByte(parameters.minorStatusCatchBonus);
  if (status === "major") return clampByte(parameters.majorStatusCatchBonus);
  return 0;
}

export function gen1HpFactor(
  parameters: BallRoutineParameters,
  ball: Gen1BallKind,
  maxHp: number,
  currentHp: number,
): number {
  if (ball === "master") return 256;

  const ballDivisor = positiveInt(
    ball === "great" ? parameters.greatHpDivisor : parameters.otherHpDivisor,
  );
  const hpDivisor = positiveInt(parameters.currentHpDivisor);
  const maximum = positiveInt(maxHp);
  const current = Math.max(1, Math.min(maximum, positiveInt(currentHp)));

  const scaledMax = Math.floor((maximum * 255) / ballDivisor);
  const scaledCurrent = Math.max(Math.floor(current / hpDivisor), 1);
  return Math.floor(scaledMax / scaledCurrent);
}

export function simulateNominalGen1Catch(
  parameters: BallRoutineParameters,
  input: Gen1CatchSimulationInput,
): Gen1CatchSimulationResult {
  const rawRate = clampByte(input.catchRate);
  const effectiveCatchRate = input.ball === "safari"
    ? applySafariCatchAdjustment(rawRate, input.safariAdjustment ?? "none")
    : rawRate;
  const effectiveRandomCeiling = effectiveBallRandomCeiling(parameters, input.ball);
  const statusBonus = statusCatchBonus(parameters, input.status);

  if (input.ball === "master") {
    return {
      probability: 1,
      effectiveCatchRate,
      effectiveRandomCeiling,
      statusCatchBonus: statusBonus,
      hpFactor: 256,
      secondRollChance: 1,
      automaticFromHpFactor: true,
    };
  }

  const hpFactor = gen1HpFactor(
    parameters,
    input.ball,
    input.maxHp,
    input.currentHp,
  );
  const automaticFromHpFactor = hpFactor > 255;
  const cappedHpFactor = Math.min(hpFactor, 255);
  const secondRollChance = automaticFromHpFactor
    ? 1
    : (cappedHpFactor + 1) / 256;

  let totalChance = 0;
  const outcomes = effectiveRandomCeiling + 1;

  for (let firstRoll = 0; firstRoll <= effectiveRandomCeiling; firstRoll += 1) {
    if (statusBonus > firstRoll) {
      totalChance += 1;
      continue;
    }

    const adjustedRoll = firstRoll - statusBonus;
    if (adjustedRoll > effectiveCatchRate) continue;

    totalChance += secondRollChance;
  }

  return {
    probability: totalChance / outcomes,
    effectiveCatchRate,
    effectiveRandomCeiling,
    statusCatchBonus: statusBonus,
    hpFactor,
    secondRollChance,
    automaticFromHpFactor,
  };
}

export function formatCatchPercent(probability: number): string {
  if (!Number.isFinite(probability)) return "—";
  const percent = Math.max(0, Math.min(1, probability)) * 100;
  if (percent === 100) return "100%";
  if (percent >= 10) return percent.toFixed(1) + "%";
  return percent.toFixed(2) + "%";
}
