import assert from "node:assert/strict";
import type { ProjectSource } from "../src/core/types";

// Run the real GivePokemon wrapper and party/PC branch routine on the GB CPU.
// Data creation and text drawing are instrumented boundaries; the actual carry,
// success flags, retry branches, and object-removal ordering execute unchanged.
export async function pokemonGiftRuntimeProbes(source: ProjectSource, runProbe: (asm: string, expected: string[]) => Promise<void>) {
  const engine = (await source.readText("engine/events/give_pokemon.asm")).split("SetPokedexOwnedFlag:")[0].replace(/callfar /g, "call ");
  const wrapper = (await source.readText("home/give.asm")).split("GivePokemon::")[1].replace("farjp _GivePokemon", "jp _GivePokemon");
  const events = await source.readText("constants/event_constants.asm");
  let count = 0;
  for (const [path, label, kind] of [
    ["scripts/ViridianCity.asm", "ViridianCityYoungster1Text", "npc"],
    ["scripts/CeladonMansionRoofHouse.asm", "CeladonMansionRoofHouseEeveePokeballText", "ball"],
    ["scripts/SilphCo7F.asm", "SilphCo7FSilphWorkerM1Text", "lapras"],
  ] as const) {
    const script = await source.readText(path);
    const start = script.indexOf(`${label}:`);
    let code = script.slice(start).split(/\n[A-Za-z_]\w*:{1,2}\n/)[0];
    const match = code.match(/yellow-editor-interaction: (.*)/);
    const managed = match ? JSON.parse(match[1]) : null;
    if (kind === "npc" && !managed?.values.pokemon) continue;
    if (managed) code = script.slice(start, script.indexOf(`; yellow-editor-interaction-code-end ${label}`, start));
    if (kind === "lapras") {
      code = code.split("\n.HaveThisPokemonText\n")[0];
      for (const name of ["HaveThisPokemon", "LaprasDescription", "IsOurPresidentOk", "Saved"]) code = code.replaceAll(`.${name}Text`, `Probe${name}Text`);
    }
    code = code.replaceAll("\ttext_asm", "\tdb 8").replaceAll("predef HideObject", "call HideObject");
    const args = code.match(/lb bc,\s*(\w+),\s*(\d+)/)!;
    assert.ok(args);
    for (const scenario of [
      { name: "party space", party: 5, box: 20, partyAdds: 1, boxAdds: 0, success: true },
      { name: "party full / PC space", party: 6, box: 19, partyAdds: 0, boxAdds: 1, success: true },
      { name: "party and PC full", party: 6, box: 20, partyAdds: 0, boxAdds: 0, success: false },
      { name: "full then retry", party: 6, box: 20, partyAdds: 0, boxAdds: 1, success: true, retry: true },
      ...(managed || kind === "lapras" ? [{ name: "successful then repeat", party: 5, box: 19, partyAdds: 1, boxAdds: 0, success: true, repeat: true }] : []),
    ]) {
      const prefix = managed?.prefix;
      const flagValue = managed ? Number.parseInt(events.match(new RegExp(`DEF ${managed.flag} EQU \\$([a-f0-9]+)`))![1], 16) : null;
      const bindings = { wPartyCount: "$c000", wBoxCount: "$c001", wAddedToParty: "$c002", wCurPartySpecies: "$c003", wCurEnemyLevel: "$c004", wMonDataLocation: "$c005", wEnemyBattleStatus3: "$c006", wEnemyMonSpecies2: "$c007", wCurrentBoxNum: "$c008", wDoNotWaitForButtonPressAfterDisplayingText: "$c009", wToggleableObjectIndex: "$c00a", wStatusFlags4: "$c00b", wStringBuffer: "$c030", wEventFlags: "$c100", PARTY_LENGTH: "6", MONS_PER_BOX: "20", BOX_NUM_MASK: "$7f", BIT_GOT_LAPRAS: "0", TOGGLE_CELADON_MANSION_EEVEE_GIFT: "69", [args[1]]: "$66" };
      const textDefs = managed ? ["Original", "Dialogue", "BagFullText", "AlreadyText"].map((suffix, i) => `DEF ${prefix}${suffix} EQU $d00${i + 1}`) : kind === "lapras" ? ["HaveThisPokemon", "LaprasDescription", "IsOurPresidentOk", "Saved"].map((name, i) => `DEF Probe${name}Text EQU $d00${i + 1}`) : [];
      const setup = ["\tdi", "\tld sp, $dfff", "\tld hl, $c000", "\tld bc, $400", ".clear:", "\txor a", "\tld [hli], a", "\tdec bc", "\tld a, b", "\tor c", "\tjr nz, .clear", `\tld a, ${scenario.party}`, "\tld [wPartyCount], a", `\tld a, ${scenario.box}`, "\tld [wBoxCount], a", `\tcall ${label} + 1`];
      if ("retry" in scenario) setup.push("\tld a, 19", "\tld [wBoxCount], a", `\tcall ${label} + 1`);
      if ("repeat" in scenario) setup.push(`\tcall ${label} + 1`);
      const stubs = [
        "PrintText:", "\tld a, l", "\tld [$c016], a", "\tld hl, $c014", "\tinc [hl]", "\tret",
        "SetPokedexOwnedFlag:", "\tld hl, $c013", "\tinc [hl]", "\tld hl, $d020", "\tjp PrintText",
        "LoadEnemyMonData:", "\tret",
        "AddPartyMon:", "\tld hl, $c010", "\tinc [hl]", "\tld hl, wPartyCount", "\tinc [hl]", "\tjr RecordMon",
        "SendNewMonToBox:", "\tld hl, $c011", "\tinc [hl]", "\tld hl, wBoxCount", "\tinc [hl]",
        "RecordMon:", "\tld a, [wCurPartySpecies]", "\tld [$c017], a", "\tld a, [wCurEnemyLevel]", "\tld [$c018], a", "\tret",
        "HideObject:", "\tld hl, $c012", "\tinc [hl]", "\tret",
        "WaitForTextScrollButtonPress:", "\tld hl, $c015", "\tinc [hl]", "\tret",
        "EnableAutoTextBoxDrawing:", "TextScriptEnd:", "\tret",
        "DEF BoxIsFullText EQU $d021", "DEF SentToBoxText EQU $d022", "DEF UnknownTerminator_f6794 EQU $d023",
      ];
      const asm = ['INCLUDE "macros/const.asm"', 'INCLUDE "macros/code.asm"', ...Object.entries(bindings).map(([key, value]) => `DEF ${key} EQU ${value}`), ...textDefs, events, await source.readText("macros/scripts/events.asm"), 'SECTION "Header", ROM0[$100]', '\tjp Entry', '\tds $150 - @, 0', 'SECTION "Code", ROM0[$150]', 'Entry:', ...setup, 'ProbeDone:', '\thalt', '\tjr ProbeDone', code, "GivePokemon:", wrapper, engine, ...stubs].join("\n");
      const expected = [`c010=${scenario.partyAdds}`, `c011=${scenario.boxAdds}`, `c012=${kind === "ball" && scenario.success ? 1 : 0}`, `c013=${scenario.success ? 1 : 0}`, `c017=${scenario.success ? "66" : "0"}`, `c018=${scenario.success ? Number(args[2]).toString(16) : "0"}`];
      if (managed) {
        expected.push(`${(0xc100 + Math.floor(flagValue! / 8)).toString(16)}=${scenario.success ? (1 << flagValue! % 8).toString(16) : "0"}`);
        expected.push(`c016=${"repeat" in scenario ? "4" : scenario.success ? "2" : "3"}`);
      } else if (kind === "lapras") expected.push(`c00b=${scenario.success ? "1" : "0"}`, `c016=${"repeat" in scenario ? "3" : scenario.success ? "2" : "21"}`);
      if (managed || kind === "lapras") expected.push(`c015=${scenario.boxAdds}`);
      await runProbe(asm, expected); count++;
    }
  }
  console.log(`  ${count} gift Pokémon CPU probes: actual party/PC delivery, full-box retries, species/level, one-time flags, repeat dialogue, receipt waits and object hiding passed`);
}
