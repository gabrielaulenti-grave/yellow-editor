import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProjectSession } from "../src/core/project";
import { defaultMoveBehavior } from "../src/core/moveBehaviors";
import { type MoveStatChanges } from "../src/core/moveStatChanges";
import type { ProjectSource, HistoryState } from "../src/core/types";

const [rootArg, rgbdsArg, cpuArg] = process.argv.slice(2);
assert.ok(rootArg && rgbdsArg && cpuArg);
const root = resolve(rootArg), rgbds = resolve(rgbdsArg), cpu = resolve(cpuArg), temp = await mkdtemp(resolve("node_modules/.move-behavior-rom-"));
const run = (command: string, args: string[]) => { const r = spawnSync(command, args, { cwd: temp, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr.slice(-12000) + r.stdout.slice(-2000)); return r.stdout; };
try {
  await cp(root, temp, { recursive: true, filter: path => !path.split("/").includes(".git") });
  async function files(folder = ""): Promise<string[]> { return (await Promise.all((await readdir(join(temp, folder), { withFileTypes: true })).filter(e => !e.name.startsWith(".")).map(e => e.isDirectory() ? files(join(folder, e.name)) : [join(folder, e.name)]))).flat(); }
  let history: HistoryState | null = null;
  const source: ProjectSource = { storageKey: temp, displayPath: temp, listFiles: files,
    exists: path => stat(join(temp, path)).then(() => true, () => false), readText: path => readFile(join(temp, path), "utf8"), readBytes: async path => new Uint8Array(await readFile(join(temp, path))),
    writeText: (path, text) => writeFile(join(temp, path), text), writeBytes: (path, data) => writeFile(join(temp, path), data), createFile: (path, data) => writeFile(join(temp, path), data, { flag: "wx" }), removeFile: path => rm(join(temp, path)), assetUrl: async () => null,
    historyStore: { persistent: false, load: async () => history, save: async value => { history = structuredClone(value); } } };
  const session = await createProjectSession(source, {} as never);
  const variants = [
    ["COUNTER", { priority: "last", counter: true }], ["TOXIC", { badlyPoisoned: true }], ["REST", { rest: true }],
    ["LEVEL", { damageMode: "level" }], ["RANDOM", { damageMode: "random" }], ["FIXED", { damageMode: "fixed", fixedDamage: 37 }], ["HALF", { recoil: "half" }], ["DIG", { charge: "dig" }],
    ["FLY", { charge: "fly" }], ["NEVER", { secondaryChance: 0 }], ["ALWAYS", { secondaryChance: 100 }], ["FIRST", { priority: "first" }], ["EXTRA", { additionalEffect: "PARALYZE_SIDE_EFFECT1", secondaryChance: 100 }],
  ] as const;
  for (const [name, patch] of variants) await session.createMove(await session.getMoveCreateDocument(), { constant: `EDITOR_${name}`, name: `ED ${name}`, power: 40, accuracy: 100, pp: 20, moveType: "NORMAL", effect: name === "EXTRA" ? "DRAIN_HP_EFFECT" : "NO_ADDITIONAL_EFFECT", animation: "POUND", soundMoveId: 1, behavior: { ...defaultMoveBehavior(), ...patch } });
  // Reuse stock move IDs for these probes, avoiding extra animation/sound bank
  // growth merely to test another property of the same native effect handler.
  for (const [id, additionalEffect, secondaryChance] of [[10, "ACCURACY_DOWN_SIDE_EFFECT", 100], [33, "EVASION_DOWN_SIDE_EFFECT", 100], [1, "ACCURACY_DOWN_SIDE_EFFECT", 0]] as const) {
    const doc = await session.getMoveEditDocument(id);
    await session.saveMoveEdit(doc, { ...doc.values, behavior: { ...doc.values.behavior!, additionalEffect, secondaryChance } });
  }
  const statMoves: Array<[string, MoveStatChanges]> = [
    ["BULK", { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "defense", stages: 1 }] }],
    ["DANCE", { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "speed", stages: 1 }] }],
    ["COIL", { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "defense", stages: 1 }, { stat: "accuracy", stages: 1 }] }],
    ["TICKLE", { target: "opponent", changes: [{ stat: "attack", stages: -1 }, { stat: "defense", stages: -1 }] }],
    ["MIXED", { target: "user", changes: [{ stat: "attack", stages: 2 }, { stat: "defense", stages: -2 }, { stat: "special", stages: 1 }, { stat: "evasion", stages: -1 }] }],
    ["GIFT", { target: "opponent", changes: [{ stat: "attack", stages: 1 }, { stat: "speed", stages: 1 }] }],
  ];
  for (const [name, statChanges] of statMoves) await session.createMove(await session.getMoveCreateDocument(), { constant: `EDITOR_STAT_${name}`, name: `STAT ${name}`, power: 0, accuracy: 100, pp: 20, moveType: "NORMAL", effect: name === "TICKLE" ? "ATTACK_DOWN1_EFFECT" : "ATTACK_UP1_EFFECT", animation: "GROWTH", soundMoveId: 74, behavior: { ...defaultMoveBehavior(), statChanges } });
  // A Red fixture can live under a parent directory named yellow-editor.
  const target = await source.exists("scripts/OaksLab_2.asm") ? "pokeyellow" : "pokered";
  // A full uninstrumented ROM must link before running focused native probes.
  console.log("Linking complete ROM:", target);
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const patchFile = async (path: string, fn: (text: string) => string) => writeFile(join(temp, path), fn(await source.readText(path)));
  const all = await files();
  const stub = async (name: string, body = "\tret") => {
    for (const path of all.filter(path => path.endsWith(".asm"))) { const text = await source.readText(path), regex = new RegExp(`^${name}:{1,2}$`, "m"); if (regex.test(text)) { await writeFile(join(temp, path), text.replace(regex, match => match + "\n" + body)); return; } }
    throw new Error(`Missing probe stub ${name}`);
  };
  // Keep mechanics native; instrument display/audio and randomness for deterministic assertions.
  for (const name of ["DelayFrames", "PlayBattleAnimation", "PlayCurrentMoveAnimation2", "UpdateHPBar2", "EffectCallBattleCore", "ApplyDamageToEnemyPokemon", "ApplyDamageToPlayerPokemon"]) await stub(name);
  await stub("PrintText", "\tpush hl\n\tld hl, $c104\n\tinc [hl]\n\tpop hl\n\tret");
  await stub("PlayCurrentMoveAnimation", "\tpush hl\n\tld hl, $c103\n\tinc [hl]\n\tpop hl\n\tret");
  await stub("BattleRandom", "\tpush hl\n\tld hl, $c102\n\tinc [hl]\n\tpop hl\n\tld a, [$c105]\n\tand a\n\tret nz\n\tld a, 7\n\tret");
  const set = (name: string, value: string | number) => [`\tld a, ${value}`, `\tld [${name}], a`];
  let checkNumber = 0;
  const check = (name: string, value: string | number) => [`\tld a, ${++checkNumber & 255}`, "\tld [$c101], a", `\tld a, [${name}]`, `\tcp ${value}`, "\tjp nz, EditorBehaviorFail"];
  const probeBodies: string[] = [];
  const body = (bank: string, lines: string[]) => { probeBodies.push([`Editor${bank}Probe::`, ...lines.map(line => line.replace(/^\tcall ([A-Za-z_]\w*)$/, "\tfarcall $1")), "\tret", ""].join("\n")); return ""; };
  const core = ["\tld bc, $1234", "\tld de, $5678", "\tld hl, $9abc", "\tld a, EDITOR_FIRST", "\tcall EditorMBCoreFirst", "\tjp nz, EditorBehaviorFail", "\tld a, b", "\tcp $12", "\tjp nz, EditorBehaviorFail", "\tld a, c", "\tcp $34", "\tjp nz, EditorBehaviorFail", "\tld a, d", "\tcp $56", "\tjp nz, EditorBehaviorFail", "\tld a, e", "\tcp $78", "\tjp nz, EditorBehaviorFail", "\tld a, h", "\tcp $9a", "\tjp nz, EditorBehaviorFail", "\tld a, l", "\tcp $bc", "\tjp nz, EditorBehaviorFail", ...set("hWhoseTurn", 0), ...set("wPlayerSelectedMove", "EDITOR_COUNTER"), ...set("wEnemySelectedMove", "POUND"), ...set("wEnemyMovePower", 40), ...set("wEnemyMoveType", "NORMAL"), ...set("wPlayerMoveAccuracy", 255), ...set("wPlayerMoveEffect", "NO_ADDITIONAL_EFFECT"), ...set("wDamage", 0), ...set("wDamage + 1", 12), "\tcall HandleCounterMove", ...check("wDamage + 1", 24)];
  const readProbeEnd = core.indexOf("\tld a, 0");
  assert.ok(readProbeEnd > 0);
  await patchFile("engine/battle/core.asm", text => text + ["EditorCoreReadProbe::", ...core.splice(0, readProbeEnd), "\tret", ""].join("\n"));
  core.unshift("\tcall EditorCoreReadProbe");
  core.push(...set("wEnemySelectedMove", "EDITOR_COUNTER"), "\tcall HandleCounterMove", ...check("wMoveMissed", 1));
  for (const side of ["Player", "Enemy"]) for (const [kind, expected] of [["FIXED", 37], ["LEVEL", 55], ["RANDOM", 7]] as const) core.push(...set("hWhoseTurn", side === "Player" ? 0 : 1), ...set("wBattleMonLevel", 55), ...set("wEnemyMonLevel", 55), ...set(`w${side}MoveNum`, `EDITOR_${kind}`), ...set(`w${side}MoveEffect`, "SPECIAL_DAMAGE_EFFECT"), `\tcall ApplyAttackTo${side === "Player" ? "Enemy" : "Player"}Pokemon`, ...check("wDamage + 1", expected));
  await patchFile("engine/battle/core.asm", text => text + body("Core", core));
  const effects: string[] = [];
  for (const side of ["Player", "Enemy"]) {
    const targetSide = side === "Player" ? "Enemy" : "Battle";
    effects.push(...set("wMoveMissed", 0), ...set("wPlayerBattleStatus1", 0), ...set("wEnemyBattleStatus1", 0), ...set("hWhoseTurn", side === "Player" ? 0 : 1), ...set(`w${side}MoveNum`, "EDITOR_TOXIC"), ...set(`w${side}MoveEffect`, "POISON_EFFECT"), ...set(`w${side}MoveAccuracy`, 255), ...set(`w${targetSide}MonStatus`, 0), "\tcall PoisonEffect", ...check(`w${targetSide}MonStatus`, "1 << PSN"), ...check(`w${targetSide === "Battle" ? "Player" : "Enemy"}BattleStatus3`, "1 << BADLY_POISONED"));
    for (const [name, expected] of [["NEVER", "0"], ["ALWAYS", "1 << FRZ"]]) effects.push(...set(`w${side}MoveNum`, `EDITOR_${name}`), ...set(`w${side}MoveEffect`, "FREEZE_SIDE_EFFECT1"), ...set(`w${side}MoveType`, "ICE"), ...set(`w${targetSide}MonStatus`, 0), "\tcall FreezeBurnParalyzeEffect", ...check(`w${targetSide}MonStatus`, expected));
    for (const name of ["DIG", "FLY"]) effects.push(...set(`w${side}MoveNum`, `EDITOR_${name}`), ...set(`w${side}MoveEffect`, "CHARGE_EFFECT"), ...set(`w${side}BattleStatus1`, 0), "\tcall ChargeEffect", ...check(`w${side}BattleStatus1`, "(1 << CHARGING_UP) | (1 << INVULNERABLE)"));
  }
  for (const side of ["Player", "Enemy"]) {
    const user = side === "Player" ? "Battle" : "Enemy", target = side === "Player" ? "Enemy" : "Battle";
    effects.push(...set("hWhoseTurn", side === "Player" ? 0 : 1), ...set("wPlayerBattleStatus1", 0), ...set("wEnemyBattleStatus1", 0), ...set("wMoveMissed", 0), ...set("wDamage", 0), ...set("wDamage + 1", 30), ...set(`w${side}MoveNum`, "EDITOR_EXTRA"), ...set(`w${side}MoveType`, "ELECTRIC"), ...set(`w${side}MoveEffect`, "DRAIN_HP_EFFECT"), ...set(`w${user}MonHP`, 0), ...set(`w${user}MonHP + 1`, 100), ...set(`w${target}MonHP`, 0), ...set(`w${target}MonHP + 1`, 100), ...set(`w${target}MonStatus`, 0), "\tcall EditorMBApplySecondary", ...check(`w${target}MonStatus`, "1 << PAR"), ...check(`w${side}MoveEffect`, "DRAIN_HP_EFFECT"), ...check("wMoveMissed", 0));
    effects.push(...set(`w${target}MonStatus`, 0), ...set("wMoveMissed", 1), "\tcall EditorMBApplySecondary", ...check(`w${target}MonStatus`, 0), ...set("wMoveMissed", 0), ...set(`w${target}MonHP + 1`, 0), "\tcall EditorMBApplySecondary", ...check(`w${target}MonStatus`, 0));
  }
  // Execute the actual post-damage branches, including their no-effect fast path.
  for (const side of ["Player", "Enemy"]) for (const primary of ["NO_ADDITIONAL_EFFECT", "FLINCH_SIDE_EFFECT1"]) {
    const target = side === "Player" ? "Enemy" : "Battle", user = side === "Player" ? "Battle" : "Enemy", targetState = side === "Player" ? "Enemy" : "Player";
    const entry = side === "Player" ? "MirrorMoveCheck.executeOtherEffects" : "EnemyCheckIfMirrorMoveEffect.notMultiHitMove";
    effects.push(...set("hWhoseTurn", side === "Player" ? 0 : 1), ...set("wMoveMissed", 0), ...set("wDamage", 0), ...set("wDamage + 1", 30), ...set(`w${side}MoveNum`, "EDITOR_EXTRA"), ...set(`w${side}MoveType`, "ELECTRIC"), ...set(`w${side}MoveEffect`, primary), ...set(`w${user}MonHP`, 0), ...set(`w${user}MonHP + 1`, 100), ...set(`w${target}MonHP`, 0), ...set(`w${target}MonHP + 1`, 100), ...set(`w${target}MonStatus`, 0), ...set(`w${targetState}BattleStatus1`, 0), `\tfarcall ${entry}`, ...check(`w${target}MonStatus`, "1 << PAR"), ...check(`w${side}MoveEffect`, primary));
    if (primary === "FLINCH_SIDE_EFFECT1") effects.push(...check(`w${targetState}BattleStatus1`, "1 << FLINCHED"));
  }
  // The two unnamed native slots map to accuracy/evasion in the general stat
  // handler. Exercise the actual post-damage hook, chance endpoints, stage floor,
  // misses and Substitute without changing the engine's existing effect IDs.
  for (const side of ["Player", "Enemy"]) for (const [move, index, chance] of [["SCRATCH", 4, 100], ["TACKLE", 5, 100], ["POUND", 4, 0]] as const) {
    const target = side === "Player" ? "Enemy" : "Player", userMon = side === "Player" ? "Battle" : "Enemy", targetMon = side === "Player" ? "Enemy" : "Battle";
    const entry = side === "Player" ? "MirrorMoveCheck.executeOtherEffects" : "EnemyCheckIfMirrorMoveEffect.notMultiHitMove";
    for (const mode of ["hit", "miss", "substitute", "floor"] as const) {
      effects.push(...set("$c105", 128), ...set("hWhoseTurn", side === "Player" ? 0 : 1), ...set("wLinkState", 0), ...set("wPlayerBattleStatus1", 0), ...set("wEnemyBattleStatus1", 0), ...set("wPlayerBattleStatus2", 0), ...set("wEnemyBattleStatus2", 0), ...set("wMoveMissed", mode === "miss" ? 1 : 0), ...set("wDamage", 0), ...set("wDamage + 1", 20), ...set(`w${side}MoveNum`, move), ...set(`w${side}MoveEffect`, "NO_ADDITIONAL_EFFECT"), ...set(`w${userMon}MonHP`, 0), ...set(`w${userMon}MonHP + 1`, 100), ...set(`w${targetMon}MonHP`, 0), ...set(`w${targetMon}MonHP + 1`, 100), ...Array.from({ length: 6 }, (_, i) => set(`w${target}MonStatMods + ${i}`, mode === "floor" && i === index ? 1 : 7)).flat());
      if (mode === "substitute") effects.push(...set(`w${target}BattleStatus2`, "1 << HAS_SUBSTITUTE_UP"));
      effects.push(`\tfarcall ${entry}`, ...check(`w${target}MonStatMods + ${index}`, mode === "floor" ? 1 : mode === "hit" && chance === 100 ? 6 : 7), ...check(`w${target}MonStatMods + ${index === 4 ? 5 : 4}`, 7), ...check(`w${side}MoveEffect`, "NO_ADDITIONAL_EFFECT"), ...check("wMoveMissed", mode === "miss" ? 1 : 0));
    }
  }
  effects.push(...set("$c105", 0));
  await patchFile("engine/battle/effects.asm", text => text + body("Effects", effects));
  const heal: string[] = [], recoil: string[] = [];
  for (const side of ["Battle", "Enemy"]) {
    const move = side === "Battle" ? "Player" : "Enemy";
    heal.push(...set("hWhoseTurn", side === "Battle" ? 0 : 1), ...set(`w${move}MoveNum`, "EDITOR_REST"), ...set(`w${side}MonHP`, 0), ...set(`w${side}MonHP + 1`, 20), ...set(`w${side}MonMaxHP`, 0), ...set(`w${side}MonMaxHP + 1`, 100), ...set(`w${side}MonStatus`, "1 << PSN"), "\tcall HealEffect_", ...check(`w${side}MonHP + 1`, 100), ...check(`w${side}MonStatus`, 2));
    recoil.push(...set("hWhoseTurn", side === "Battle" ? 0 : 1), ...set(`w${move}MoveNum`, "EDITOR_HALF"), ...set(`w${side}MonHP`, 0), ...set(`w${side}MonHP + 1`, 100), ...set("wDamage", 0), ...set("wDamage + 1", 64), "\tcall RecoilEffect_", ...check(`w${side}MonHP + 1`, 68));
  }
  await patchFile("engine/battle/move_effects/heal.asm", text => text + body("Heal", heal));
  await patchFile("engine/battle/move_effects/recoil.asm", text => text + body("Recoil", recoil));
  const stats: string[] = [];
  for (const side of ["Player", "Enemy"]) {
    const turn = side === "Player" ? 0 : 1;
    const reset = (name: string) => [
      ...set("hWhoseTurn", turn), ...set(`w${side}MoveNum`, `EDITOR_STAT_${name}`), ...set(`w${side}MoveEffect`, name === "TICKLE" ? "ATTACK_DOWN1_EFFECT" : "ATTACK_UP1_EFFECT"), ...set(`w${side}MoveAccuracy`, 255),
      ...set("wCalculateWhoseStats", "$a5"), ...set("wMoveMissed", 0), ...set("wLinkState", 0), ...set("wObtainedBadges", 0),
      ...["$c102", "$c103", "$c104"].flatMap(p => set(p, 0)),
      ...["Player", "Enemy"].flatMap(s => [
        ...["BattleStatus1", "BattleStatus2"].flatMap(p => set(`w${s}${p}`, 0)),
        ...Array.from({ length: 6 }, (_, n) => set(`w${s}MonStatMods + ${n}`, 7)).flat(),
        ...["Attack", "Defense", "Speed", "Special"].flatMap(stat => [...set(`w${s}MonUnmodified${stat}`, 0), ...set(`w${s}MonUnmodified${stat} + 1`, 100), ...set(`w${s === "Player" ? "Battle" : "Enemy"}Mon${stat}`, 0), ...set(`w${s === "Player" ? "Battle" : "Enemy"}Mon${stat} + 1`, 100)]),
        ...set(`w${s === "Player" ? "Battle" : "Enemy"}MonStatus`, 0),
      ]),
    ];
    const execute = () => ["\tcall JumpMoveEffect", ...check("hWhoseTurn", turn), ...check("wCalculateWhoseStats", "$a5"), ...check(`w${side}MoveEffect`, "ATTACK_UP1_EFFECT")];
    for (const [name, group] of statMoves) {
      const recipient = group.target === "user" ? side : side === "Player" ? "Enemy" : "Player";
      const mon = recipient === "Player" ? "Battle" : "Enemy";
      stats.push(...reset(name), "\tcall JumpMoveEffect", ...check("hWhoseTurn", turn), ...check("wCalculateWhoseStats", "$a5"), ...check(`w${side}MoveEffect`, name === "TICKLE" ? "ATTACK_DOWN1_EFFECT" : "ATTACK_UP1_EFFECT"), ...check("wMoveMissed", 0), ...check("$c102", group.target === "opponent" ? 1 : 0), ...check("$c103", 1), ...check("$c104", group.changes.length));
      for (const [i, stat] of ["attack", "defense", "speed", "special", "accuracy", "evasion"].entries()) {
        const delta = group.changes.find(row => row.stat === stat)?.stages ?? 0;
        stats.push(...check(`w${recipient}MonStatMods + ${i}`, 7 + delta));
        if (i < 4) { const value = ({ "-2": 50, "-1": 66, "0": 100, "1": 150, "2": 200 } as Record<string, number>)[delta]; stats.push(...check(`w${mon}Mon${["Attack", "Defense", "Speed", "Special"][i]} + 1`, value)); }
      }
    }
    stats.push(...reset("BULK"), ...set(`w${side}MonStatMods`, 13), ...execute(), ...check(`w${side}MonStatMods`, 13), ...check(`w${side}MonStatMods + 1`, 8), ...check("wMoveMissed", 0), ...check("$c103", 1), ...check("$c104", 1));
    stats.push(...reset("BULK"), ...set(`w${side}MonStatMods`, 13), ...set(`w${side}MonStatMods + 1`, 13), ...execute(), ...check("wMoveMissed", 1), ...check("$c103", 0), ...check("$c104", 1));
    stats.push(...reset("MIXED"), ...set(`w${side}MonStatMods`, 12), ...set(`w${side}MonStatMods + 1`, 2), ...execute(), ...check(`w${side}MonStatMods`, 13), ...check(`w${side}MonStatMods + 1`, 1), ...check(`w${side === "Player" ? "Battle" : "Enemy"}MonAttack`, 1), ...check(`w${side === "Player" ? "Battle" : "Enemy"}MonAttack + 1`, 144));
    const opponent = side === "Player" ? "Enemy" : "Player";
    stats.push(...reset("TICKLE"), ...set(`w${opponent}MonStatMods`, 1), "\tcall JumpMoveEffect", ...check(`w${opponent}MonStatMods`, 1), ...check(`w${opponent}MonStatMods + 1`, 6), ...check("wMoveMissed", 0), ...check("$c104", 1));
    for (const [field, value, rolls] of [[`w${side}MoveAccuracy`, 0, 1], [`w${opponent}BattleStatus2`, "1 << HAS_SUBSTITUTE_UP", 0], [`w${opponent}BattleStatus2`, "1 << PROTECTED_BY_MIST", 0], [`w${opponent}BattleStatus1`, "1 << INVULNERABLE", 0]] as const) {
      stats.push(...reset("TICKLE"), ...set(field, value), "\tcall JumpMoveEffect", ...check(`w${opponent}MonStatMods`, 7), ...check(`w${opponent}MonStatMods + 1`, 7), ...check("wMoveMissed", 1), ...check("$c102", rolls), ...check("$c103", 0), ...check("hWhoseTurn", turn), ...check("wCalculateWhoseStats", "$a5"), ...check(`w${side}MoveEffect`, "ATTACK_DOWN1_EFFECT"));
    }
    const mon = side === "Player" ? "Battle" : "Enemy";
    stats.push(...reset("BULK"), ...set("wObtainedBadges", "$55"), ...set(`w${mon}MonStatus`, "1 << BRN"), ...execute(), ...check(`w${mon}MonAttack + 1`, side === "Player" ? 84 : 75), ...check(`w${mon}MonDefense + 1`, side === "Player" ? 168 : 150), ...check(`w${mon}MonSpeed + 1`, 100));
    stats.push(...reset("DANCE"), ...set(`w${mon}MonStatus`, "1 << PAR"), ...execute(), ...check(`w${mon}MonSpeed + 1`, 37));
  }
  body("Stats", stats);
  await patchFile("main.asm", text => text + probeBodies.map((lines, i) => `\nPUSHS\nSECTION "Move behavior probe driver ${i}", ROMX\n${lines}\nPOPS\n`).join(""));
  const boot = ["\tdi", "\tld sp, wStack", "\txor a", "\tldh [rIE], a", "\tldh [rIF], a", "\tldh [rLCDC], a", "\tld hl, STARTOF(WRAM0)", "\tld bc, SIZEOF(WRAM0)", ".clear", "\tld [hli], a", "\tdec bc", "\tld d, a", "\tld a, b", "\tor c", "\tld a, d", "\tjr nz, .clear", ...["Core", "Effects", "Heal", "Recoil", "Stats"].flatMap((name, i) => [...set("wUnusedPlayerDataByte", i + 1), `\tfarcall Editor${name}Probe`]), ...set("wUnusedPlayerDataByte", "$5a"), ".done", "\tjr .done", "EditorBehaviorFail::", "\tld a, [wUnusedPlayerDataByte]", "\tld [$c100], a", ...set("wUnusedPlayerDataByte", "$ff"), ".failed", "\tjr .failed", ""];
  await patchFile("home/init.asm", text => text.replace(/Init::[\s\S]*?(?=^[A-Za-z_]\w*::{0,1})/m, "Init::\n" + boot.join("\n")));
  // Extra probe drivers share the same original code banks.
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const program = join(temp, "behavior-probe");
  run("cc", ["-std=gnu11", "-O2", `-I${join(cpu, "src")}`, resolve("tests/moveBehaviorProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(cpu, "src", file)), "-lm", "-o", program]);
  console.log(run(program, [join(temp, `${target}.gbc`), join(temp, `${target}.sym`)]));
} finally { if (process.env.KEEP_MOVE_BEHAVIOR_ROM) console.log("Behavior fixture:", temp); else await rm(temp, { recursive: true, force: true }); }
