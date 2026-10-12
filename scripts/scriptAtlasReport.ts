import assert from "node:assert/strict";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildScriptAtlas, type ScriptAtlas, type AtlasMap } from "../src/core/scriptAtlas";
import type { ProjectSource } from "../src/core/types";

const args = process.argv.slice(2);
const check = args.includes("--check");
const jsonAt = args.indexOf("--json-dir");
const jsonDirectory = jsonAt < 0 ? null : args[jsonAt + 1];
if (jsonAt >= 0) { assert.ok(jsonDirectory, "--json-dir needs a directory"); args.splice(jsonAt, 2); }
const projects = args.filter(arg => arg !== "--check");
assert.equal(projects.length, 2, "Usage: npm run scripts:atlas -- RED_SOURCE YELLOW_SOURCE [--check] [--json-dir OUTPUT]");
const pinned = [
  { game: "pokered", repository: "pret/pokered", sha: "d2704a63c26f9ba046ade877445216b3de0519a4" },
  { game: "pokeyellow", repository: "pret/pokeyellow", sha: "e89ead154b9968aa50eed9328ff2b38b6c194382" },
];
const output = resolve("docs/script-atlas");
await mkdir(output, { recursive: true });
if (jsonDirectory) await mkdir(resolve(jsonDirectory), { recursive: true });
const pipe = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const allRoutines = (atlas: ScriptAtlas) => atlas.maps.flatMap(map => map.routines);
function count(atlas: ScriptAtlas) {
  const routines = allRoutines(atlas), operations = routines.flatMap(r => r.operations);
  return { scriptFiles: atlas.audit.fileCount, mapGroups: atlas.maps.length, globalLabels: routines.length,
    stateEntries: sum(atlas.maps.map(m => m.stateEntries.length)), localLabels: sum(routines.map(r => r.localLabels.length)),
    objects: atlas.maps.flatMap(m => m.triggers).filter(t => t.kind === "object").length,
    signs: atlas.maps.flatMap(m => m.triggers).filter(t => t.kind === "sign").length,
    yesNoCalls: atlas.references.filter(r => r.target === "YesNoChoice").length,
    yesNoBoundBranches: operations.filter(n => n.type === "service" && n.service === "yes-no" && n.branch).length,
    movementNodes: operations.filter(n => n.type === "movement").length,
    battleNodes: operations.filter(n => n.kind === "battle").length,
    audioCalls: atlas.references.filter(r => r.target && /^(?:PlaySound(?:WaitForCurrent)?|PlayMusic|PlayDefaultMusic|StopAllMusic|PlayCry|PlayPikachuSoundClip|Music_\w+)$/.test(r.target)).length,
    audioNodes: operations.filter(n => n.kind === "music").length,
    soundCallsWithoutSemanticNode: sum(routines.map(r => r.references.filter(ref =>
      ["PlaySound", "PlaySoundWaitForCurrent"].includes(ref.target ?? "") && !r.operations.some(n => n.source.lineStart <= ref.line && n.source.lineEnd >= ref.line)).length)),
    reviewedContracts: atlas.contracts.filter(c => c.sourceStatus === "reviewed-source").length,
    references: atlas.references.length,
    missingLiteralReferences: atlas.references.filter(r => r.resolution === "missing").length,
    ambiguousReferences: atlas.references.filter(r => r.resolution === "ambiguous").length,
    classificationBlockers: atlas.audit.releaseReadiness.blockerCount,
  };
}
async function save(path: string, contents: string) {
  if (check) assert.equal(await readFile(path, "utf8"), contents, `Stale atlas: ${path}. Regenerate the pinned source reports.`);
  else await writeFile(path, contents);
}
function sourceLink(repository: string, sha: string, path: string, line?: number) { return `https://github.com/${repository}/blob/${sha}/${path}${line ? `#L${line}` : ""}`; }
function groupRow(map: AtlasMap, repository: string, sha: string) {
  const ops = map.routines.flatMap(r => r.operations), refs = map.routines.flatMap(r => r.references);
  return `| [${map.name}](${sourceLink(repository, sha, map.paths[0])}) | ${map.paths.length} | ${map.routines.length} | ${map.stateEntries.length} | ${refs.filter(r => r.target === "YesNoChoice").length} | ${ops.filter(n => n.type === "movement").length} | ${ops.filter(n => n.kind === "battle").length} | ${refs.filter(r => r.target && /^(?:PlaySound(?:WaitForCurrent)?|PlayMusic|PlayDefaultMusic|StopAllMusic|PlayCry|PlayPikachuSoundClip|Music_\w+)$/.test(r.target)).length} | ${map.audit.structuralInvocations}/${map.audit.unresolvedInvocations}/${map.audit.unboundSemanticInvocations} |`;
}
function gameReport(atlas: ScriptAtlas, game: typeof pinned[number]) {
  const stats = count(atlas);
  const gaps = atlas.audit.constructs.filter(c => c.status === "unresolved" || c.status === "structural" || c.status === "semantic" && !c.familyId);
  const lines = [`# ${game.game} script atlas`, "", `Source: [${game.repository}@${game.sha}](https://github.com/${game.repository}/tree/${game.sha}/scripts).`, "",
    `Inventories **${stats.scriptFiles} script files**, **${stats.mapGroups} script groups**, **${stats.globalLabels} global labels**, and **${stats.stateEntries} declared state entries**. Includes ${stats.localLabels} scoped local labels, ${stats.objects} object triggers, and ${stats.signs} signs.`, "",
    "Groups include companion files and non-map helpers. Global labels include executable routines, dialogue, movement data, and tables. Semantic node counts are source occurrences, not unique scenes or supported writer actions.", "",
    "## Map and script-group inventory", "",
    "`S/U/B` counts structurally classified invocations, unresolved invocations, and semantic invocations without a frozen family. A zero value does not prove arbitrary editing or composition safe.", "",
    "| Group | Files | Global labels | States | Yes/No calls | Movement nodes | Battle nodes | Audio calls | S/U/B |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...atlas.maps.map(map => groupRow(map, game.repository, game.sha)), "", "## Classification backlog", "",
    `The production audit reports **${stats.classificationBlockers} distinct classification blockers**. Some are engine bookkeeping or declaration macros; this is a review queue, not a count of broken scripts.`, "",
    "| Construct | Kind | Status | Occurrences | Example | Current explanation |", "| --- | --- | --- | ---: | --- | --- |",
    ...gaps.map(c => { const e = c.examples[0]; return `| ${c.name} | ${c.kind} | ${c.status}${c.status === "semantic" ? " (unbound)" : ""} | ${c.occurrences} | [${e.path}:${e.line}](${sourceLink(game.repository, game.sha, e.path, e.line)}) | ${pipe(c.reason)} |`; }), "",
    "## Literal-reference exceptions", "",
    "Missing targets can be macro-generated symbols, RGBDS anonymous labels, or unresolved expressions. They are retained for review; a lexical lookup failure is not a ROM linker error.", "",
    "| Source | Owner | Kind | Target/expression | Resolution |", "| --- | --- | --- | --- | --- |",
    ...atlas.references.filter(r => r.resolution === "missing" || r.resolution === "ambiguous").map(r => `| [${r.path}:${r.line}](${sourceLink(game.repository, game.sha, r.path, r.line)}) | ${r.owner ?? "—"} | ${r.kind} | ${pipe(r.expression)} | ${r.resolution} |`), "",
    "## Reviewed engine contracts", "", "Fingerprints verify the reviewed engine bodies. Boundary CPU probes are separate evidence; these contracts do not enable a scene writer.", "",
    "| Contract | Scheduling | Outcomes | Source status | Evidence |", "| --- | --- | --- | --- | --- |",
    ...atlas.contracts.map(c => `| ${c.id} | ${pipe(c.scheduling)} | ${pipe(c.outcomes.join("; "))} | ${c.sourceStatus} | ${c.evidence.map(e => `[${e.path}:${e.line}](${sourceLink(game.repository, game.sha, e.path, e.line ?? 1)})`).join(", ")} |`), "",
    "## Engine helper boundaries", "", "These targets resolve outside `scripts/`. Their source definitions and every caller are also in the downloadable JSON atlas. They are named dependencies; this atlas does not claim to have proven their internal register or gameplay contracts.", "",
    "| Helper | Call sites | Source definition(s) |", "| --- | ---: | --- |",
    ...atlas.engineBoundaries.map(b => `| ${b.label} | ${b.callers.length} | ${b.definitions.map(d => `[${d.path}:${d.line}](${sourceLink(game.repository, game.sha, d.path, d.line)})`).join(", ")} |`), "", "## Limits", "", ...atlas.limitations.map(s => `- ${s}`), "",
  ];
  return lines.join("\n");
}

const results: Array<{ game: typeof pinned[number]; atlas: ScriptAtlas; counts: ReturnType<typeof count> }> = [];
for (const [i, directory] of projects.entries()) {
  const root = resolve(directory), game = pinned[i];
  const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(git(["rev-parse", "HEAD"]).stdout.trim(), game.sha, `Use the pinned ${game.game} revision.`);
  assert.equal(git(["diff", "--quiet", "HEAD", "--", ":(glob)**/*.asm"]).status, 0, "Vanilla assembly sources have modifications.");
  assert.equal(git(["ls-files", "--others", "--exclude-standard", "--", ":(glob)**/*.asm"]).stdout.trim(), "", "Untracked assembly would change the vanilla inventory.");
  async function listFiles(path = ""): Promise<string[]> {
    return (await Promise.all((await readdir(join(root, path), { withFileTypes: true })).filter(e => !e.name.startsWith("."))
      .map(e => { const child = path ? `${path}/${e.name}` : e.name; return e.isDirectory() ? listFiles(child) : [child]; }))).flat();
  }
  const source = { listFiles, readText: (path: string) => readFile(join(root, path), "utf8"),
    readBytes: async (path: string) => new Uint8Array(await readFile(join(root, path))),
    exists: async (path: string) => { try { await readFile(join(root, path)); return true; } catch { return false; } },
  } as ProjectSource;
  const atlas = await buildScriptAtlas(source, game.sha, game.game), counts = count(atlas);
  assert.ok(atlas.contracts.every(c => c.sourceStatus === "reviewed-source"), "Reviewed engine contract source drifted; review the changed implementation before updating fingerprints.");
  assert.equal(new Set(atlas.maps.flatMap(map => map.paths)).size, atlas.audit.fileCount, "A script file was omitted from the atlas.");
  assert.equal(atlas.maps.flatMap(map => map.routines).length, (await Promise.all(atlas.maps.flatMap(map => map.paths).map(async path =>
    [...(await source.readText(path)).matchAll(/^\s*[A-Za-z_][A-Za-z0-9_]*:{1,2}\s*(?:;.*)?$/gm)].length))).reduce((a, b) => a + b, 0), "A global label was omitted from the atlas.");
  await save(join(output, `${game.game}.md`), gameReport(atlas, game));
  if (jsonDirectory) await writeFile(join(resolve(jsonDirectory), `${game.game}.json`), JSON.stringify(atlas, null, 2) + "\n");
  results.push({ game, atlas, counts });
  console.log(JSON.stringify({ game: game.game, revision: game.sha, inputDigest: atlas.inputDigest, ...counts }));
}
await save(join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, sourceProfiles: results.map(r => ({ game: r.game.game, revision: r.game.sha, inputDigest: r.atlas.inputDigest, counts: r.counts })) }, null, 2) + "\n");
