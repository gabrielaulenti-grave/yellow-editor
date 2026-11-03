import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProjectSession } from "../src/core/project";
import { defaultMoveBehavior } from "../src/core/moveBehaviors";
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
  const target = root.includes("yellow") ? "pokeyellow" : "pokered";
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
  for (const name of ["PrintText", "DelayFrames", "PlayBattleAnimation", "PlayCurrentMoveAnimation", "PlayCurrentMoveAnimation2", "UpdateHPBar2", "EffectCallBattleCore", "ApplyDamageToEnemyPokemon", "ApplyDamageToPlayerPokemon"]) await stub(name);
  await stub("BattleRandom", "\tld a, 7\n\tret");
  const set = (name: string, value: string | number) => [`\tld a, ${value}`, `\tld [${name}], a`];
  let checkNumber = 0;
  const check = (name: string, value: string | number) => [`\tld a, ${++checkNumber}`, "\tld [$c101], a", `\tld a, [${name}]`, `\tcp ${value}`, "\tjp nz, EditorBehaviorFail"];
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
  await patchFile("engine/battle/effects.asm", text => text + body("Effects", effects));
  const heal: string[] = [], recoil: string[] = [];
  for (const side of ["Battle", "Enemy"]) {
    const move = side === "Battle" ? "Player" : "Enemy";
    heal.push(...set("hWhoseTurn", side === "Battle" ? 0 : 1), ...set(`w${move}MoveNum`, "EDITOR_REST"), ...set(`w${side}MonHP`, 0), ...set(`w${side}MonHP + 1`, 20), ...set(`w${side}MonMaxHP`, 0), ...set(`w${side}MonMaxHP + 1`, 100), ...set(`w${side}MonStatus`, "1 << PSN"), "\tcall HealEffect_", ...check(`w${side}MonHP + 1`, 100), ...check(`w${side}MonStatus`, 2));
    recoil.push(...set("hWhoseTurn", side === "Battle" ? 0 : 1), ...set(`w${move}MoveNum`, "EDITOR_HALF"), ...set(`w${side}MonHP`, 0), ...set(`w${side}MonHP + 1`, 100), ...set("wDamage", 0), ...set("wDamage + 1", 64), "\tcall RecoilEffect_", ...check(`w${side}MonHP + 1`, 68));
  }
  await patchFile("engine/battle/move_effects/heal.asm", text => text + body("Heal", heal));
  await patchFile("engine/battle/move_effects/recoil.asm", text => text + body("Recoil", recoil));
  await patchFile("main.asm", text => text + '\nPUSHS\nSECTION "Move behavior probe drivers", ROMX\n' + probeBodies.join("\n") + '\nPOPS\n');
  const boot = ["\tdi", "\tld sp, wStack", "\txor a", "\tldh [rIE], a", "\tldh [rIF], a", "\tldh [rLCDC], a", "\tld hl, STARTOF(WRAM0)", "\tld bc, SIZEOF(WRAM0)", ".clear", "\tld [hli], a", "\tdec bc", "\tld d, a", "\tld a, b", "\tor c", "\tld a, d", "\tjr nz, .clear", ...["Core", "Effects", "Heal", "Recoil"].flatMap((name, i) => [...set("wUnusedPlayerDataByte", i + 1), `\tfarcall Editor${name}Probe`]), ...set("wUnusedPlayerDataByte", "$5a"), ".done", "\tjr .done", "EditorBehaviorFail::", "\tld a, [wUnusedPlayerDataByte]", "\tld [$c100], a", ...set("wUnusedPlayerDataByte", "$ff"), ".failed", "\tjr .failed", ""];
  await patchFile("home/init.asm", text => text.replace(/Init::[\s\S]*?(?=^[A-Za-z_]\w*::{0,1})/m, "Init::\n" + boot.join("\n")));
  // Extra probe drivers share the same original code banks.
  run("make", ["-j2", `RGBDS=${rgbds}/`, `${target}.gbc`]);
  const program = join(temp, "behavior-probe");
  run("cc", ["-std=gnu11", "-O2", `-I${join(cpu, "src")}`, resolve("tests/moveBehaviorProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map(file => join(cpu, "src", file)), "-lm", "-o", program]);
  console.log(run(program, [join(temp, `${target}.gbc`), join(temp, `${target}.sym`)]));
} finally { if (process.env.KEEP_MOVE_BEHAVIOR_ROM) console.log("Behavior fixture:", temp); else await rm(temp, { recursive: true, force: true }); }
