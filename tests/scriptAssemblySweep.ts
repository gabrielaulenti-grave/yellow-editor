import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadMacroAnalysis } from "../src/core/macroCatalog";
import { readProjectRgbdsSources } from "../src/core/projectConstants";
import { loadProjectSemanticDomains } from "../src/core/semanticDomains";
import { loadProjectMovementVocabulary } from "../src/core/movementVocabulary";
import { deriveProjectEventMacroSemantics } from "../src/core/eventMacroSemantics";
import { SCRIPT_REGRESSION_FIXTURES } from "../src/core/scriptSemanticIr";
import { loadScriptMacroEditDocument, prepareScriptMacroCallWrite } from "../src/core/scriptMacroEditing";
import { scriptRoundTripAlternatives, validateScriptSemanticRoundTrip } from "../src/core/scriptRoundTripValidation";
import { loadScriptSimpleActionCreateDocument, prepareScriptSimpleActionWrite, loadScriptEventConditionalCreateDocument, prepareScriptEventConditionalWrite } from "../src/core/scriptActionCreation";

const [rgbdsInput, binjgbInput, ...projects] = process.argv.slice(2);
assert.ok(rgbdsInput && binjgbInput && projects.length, "Supply RGBDS directory, pinned binjgb checkout, and disassembly directories.");
const rgbds = resolve(rgbdsInput);
const binjgb = resolve(binjgbInput);
const temporary = await mkdtemp(resolve("node_modules/.script-rom-"));
function run(command: string, args: string[], cwd = temporary) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || /warning:.*(?:truncat|out of range)/i.test(result.stderr ?? "")) {
    throw new Error(`${command} ${args.join(" ")}\n${result.error ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout;
}
try {
  assert.equal(run("git", ["rev-parse", "HEAD"], binjgb).trim(), "8abd0d38d5bf109d7c280b27d815a8b53168adde");
  const cpu = join(temporary, "script-runtime-probe");
  run("cc", ["-std=gnu11", "-O2", `-I${join(binjgb, "src")}`, resolve("tests/scriptRuntimeProbe.c"), ...["memory.c", "common.c", "emulator-debug.c"].map((file) => join(binjgb, "src", file)), "-lm", "-o", cpu]);
  for (const project of projects) {
    const original = resolve(project);
    const root = join(temporary, original.includes("pokeyellow") ? "yellow" : "red");
    await cp(original, root, { recursive: true, filter: (path) => !path.split("/").includes(".git") });
    async function listFiles(path = ""): Promise<string[]> {
      return (await Promise.all((await readdir(join(root, path), { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => entry.isDirectory() ? listFiles(join(path, entry.name)) : [join(path, entry.name)]))).flat();
    }
    const source = {
      readText: (path: string) => readFile(join(root, path), "utf8"),
      readBytes: async (path: string) => new Uint8Array(await readFile(join(root, path))),
      exists: async (path: string) => { try { await readFile(join(root, path)); return true; } catch { return false; } },
      listFiles,
    };
    const files = await readProjectRgbdsSources(source);
    const [analysis, movement] = await Promise.all([
      loadMacroAnalysis(source, loadProjectSemanticDomains(source, root), files),
      loadProjectMovementVocabulary(source, files),
    ]);
    const events = deriveProjectEventMacroSemantics(files);
    const yellow = files.some((file) => file.path === "scripts/OaksLab_2.asm");
    const rom = yellow ? "pokeyellow.gbc" : "pokered.gbc";
    const fixturePaths = new Set(SCRIPT_REGRESSION_FIXTURES.flatMap((fixture) => fixture.paths));
    run("make", ["clean"], root);
    run("make", ["-j2", `RGBDS=${rgbds}/`, rom], root);
    console.log(`${original}: vanilla ROM assembled and linked`);

    for (let variant = 0; variant < 3; variant++) {
      let changed = 0;
      for (const file of files.filter((file) => fixturePaths.has(file.path))) {
        const lines = file.contents.split("\n");
        for (const call of analysis.callsByScriptPath.get(file.path)?.calls ?? []) {
          let document;
          try { document = await loadScriptMacroEditDocument(file.contents, file.path, call.line, analysis); } catch { continue; }
          const args = [...document.arguments];
          for (const parameter of document.editableArgumentDomains) {
            const alternatives = scriptRoundTripAlternatives(parameter.allowedValues, args[parameter.index - 1]);
            if (alternatives.length) args[parameter.index - 1] = alternatives[variant % alternatives.length];
          }
          if (args.every((argument, index) => argument === document.arguments[index])) continue;
          const write = await prepareScriptMacroCallWrite(file.contents, file.path, call.line, call.name, document.sourceHash, args, analysis);
          validateScriptSemanticRoundTrip(file.contents, write.contents, call.line, movement, events);
          lines[call.line - 1] = write.contents.split("\n")[call.line - 1];
          changed++;
        }
        await writeFile(join(root, file.path), lines.join("\n"));
      }
      run("make", ["-j2", `RGBDS=${rgbds}/`, rom], root);
      console.log(`  edited ROM variant ${variant + 1}: ${changed} macro calls assembled and linked`);
    }

    // Exercise generated actions in complete game banks as well as isolated CPU probes.
    const actions = ["wait", "heal-party", "set-event", "reset-event"] as const;
    let generated = 0;
    for (const file of files.filter((file) => fixturePaths.has(file.path))) {
      let contents = file.contents;
      const labels = [...file.contents.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):{1,2}\s*(?:;[^\n]*)?$/gm)].map((match) => match[1]);
      for (const label of labels) {
        if (generated === 6) break;
        let document;
        try { document = await loadScriptSimpleActionCreateDocument(contents, file.path, label, analysis, movement, events); } catch { continue; }
        if (generated < 4) {
          const action = actions[generated];
          assert.ok(document.availableActions.includes(action));
          const event = action === "set-event" || action === "reset-event" ? document.eventOptions[action][0].value : undefined;
          contents = (await prepareScriptSimpleActionWrite(contents, document, { action, event, frames: 7 }, analysis, movement, events)).contents;
        } else {
          const conditional = await loadScriptEventConditionalCreateDocument(contents, file.path, label, analysis, movement, events);
          contents = (await prepareScriptEventConditionalWrite(contents, conditional, { event: conditional.eventOptions[0].value, action: { action: generated === 4 ? "wait" : "heal-party", frames: 7 } }, analysis, movement, events)).contents;
        }
        generated++;
      }
      await writeFile(join(root, file.path), contents);
    }
    assert.equal(generated, 6);
    run("make", ["-j2", `RGBDS=${rgbds}/`, rom], root);
    console.log(`  generated-action ROM: ${generated} simple/conditional insertions assembled and linked`);

    const target = "Target:\n\tret\n";
    const simple = await loadScriptSimpleActionCreateDocument(target, "scripts/Probe.asm", "Target", analysis, movement, events);
    const conditional = await loadScriptEventConditionalCreateDocument(target, "scripts/Probe.asm", "Target", analysis, movement, events);
    const options = conditional.eventOptions;
    const selected = [...new Set([options[0].value, options[Math.floor(options.length / 2)].value, options[options.length - 1].value])];
    const delay = (await source.readText("home/delay.asm")).split("\n\n")[0];
    let runtimePassed = 0;
    async function probe(body: string, event: string, initial: number, expected: number, duration: number) {
      const eventNumber = analysis.catalog.numericConstants![event];
      assert.ok(Number.isInteger(eventNumber), `No numeric event index for ${event}`);
      const address = 0xc100 + Math.floor(eventNumber / 8);
      assert.ok(address < 0xc300);
      const asm = [
        'INCLUDE "macros/const.asm"', 'INCLUDE "constants/event_constants.asm"', 'INCLUDE "macros/scripts/events.asm"',
        'DEF wEventFlags EQU $c100', 'SECTION "Header", ROM0[$100]', '\tjp Entry', '\tds $150 - @, 0',
        'SECTION "Code", ROM0[$150]', 'Entry:', '\tdi', '\tld sp, $dfff', '\txor a', '\tld [$c001], a',
        '\tld hl, $c100', '\tld bc, $200', '.clear:', '\txor a', '\tld [hli], a', '\tdec bc', '\tld a, b', '\tor c', '\tjr nz, .clear',
        `\tld a, ${initial}`, `\tld [$${address.toString(16)}], a`, '\tcall Target', 'ProbeDone:', '\thalt', '\tjr ProbeDone',
        body, delay, 'DelayFrame:', '\tld hl, $c001', '\tinc [hl]', '\tret', '',
      ].join("\n");
      const filename = join(temporary, "probe.asm");
      const object = join(temporary, "probe.o");
      const cartridge = join(temporary, "probe.gb");
      const symbols = join(temporary, "probe.sym");
      await writeFile(filename, asm);
      run(join(rgbds, "rgbasm"), ["-I", `${root}/`, "-o", object, filename], root);
      run(join(rgbds, "rgblink"), ["-n", symbols, "-o", cartridge, object]);
      run(join(rgbds, "rgbfix"), ["-v", "-p", "0", cartridge]);
      const stop = (await readFile(symbols, "utf8")).match(/^00:([0-9a-f]+) ProbeDone$/mi)![1];
      const expectations = Array.from({ length: 512 }, (_, index) => {
        const current = 0xc100 + index;
        return `${current.toString(16)}=${(current === address ? expected : 0).toString(16)}`;
      });
      run(cpu, [cartridge, stop, `c001=${duration.toString(16)}`, ...expectations]);
      runtimePassed++;
    }
    for (const event of selected) {
      const mask = 1 << (analysis.catalog.numericConstants![event] % 8);
      for (const action of ["set-event", "reset-event"] as const) {
        const write = await prepareScriptSimpleActionWrite(target, simple, { action, event }, analysis, movement, events);
        await probe(write.contents, event, action === "set-event" ? 0 : 255, action === "set-event" ? mask : 255 ^ mask, 0);
      }
      for (const frames of [1, 7, 255]) {
        const write = await prepareScriptEventConditionalWrite(target, conditional, { event, action: { action: "wait", frames } }, analysis, movement, events);
        for (const set of [false, true]) await probe(write.contents, event, set ? mask : 0, set ? mask : 0, set ? frames : 0);
      }
    }
    console.log(`  ${runtimePassed} assembled CPU probes passed: event set/reset, both conditional paths, exact delay counts, and all neighboring event bytes`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
