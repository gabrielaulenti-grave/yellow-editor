import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { assemblePages } from "./assemble-pages.mjs";

const directory = await mkdtemp(join("node_modules", ".pages-check-"));
try {
  for (const channel of ["stable", "beta"]) {
    const base = channel === "stable" ? "/yellow-editor/" : "/yellow-editor/beta/";
    const target = join(directory, channel);
    await mkdir(join(target, "assets"), { recursive: true });
    await writeFile(join(target, "index.html"), `<script type="module" src="${base}assets/app.js"></script>`);
    await writeFile(join(target, "assets/app.js"), channel);
    await writeFile(join(target, "release.json"), JSON.stringify({ channel, base,
      ref: channel === "stable" ? "main" : "beta", sha: "a".repeat(40) }));
    const outfile = join(directory, `${channel}.mjs`);
    await build({ entryPoints: ["src/platform/releaseChannel.ts"], outfile, bundle: true,
      platform: "node", format: "esm", define: { "import.meta.env": JSON.stringify({ VITE_RELEASE_CHANNEL: channel }) } });
    const { browserDatabaseName, isBetaRelease } = await import(pathToFileURL(join(process.cwd(), outfile)).href);
    assert.equal(isBetaRelease, channel === "beta");
    for (const name of ["yellow-editor", "yellow-editor-emulator"]) {
      assert.equal(browserDatabaseName(name), channel === "beta" ? `${name}-beta` : name);
    }
  }
  const stable = join(directory, "stable"), beta = join(directory, "beta"), output = join(directory, "site");
  await assemblePages(stable, beta, output);
  for (const file of ["index.html", "assets/app.js", "release.json"]) {
    assert.deepEqual(await readFile(join(output, file)), await readFile(join(stable, file)));
    assert.deepEqual(await readFile(join(output, "beta", file)), await readFile(join(beta, file)));
  }
  await assert.rejects(assemblePages(stable, beta, stable), /must be separate/);
  await assert.rejects(assemblePages(stable, beta, output), /EEXIST/);
  await writeFile(join(beta, "index.html"), '<script src="/yellow-editor/assets/app.js"></script>');
  await assert.rejects(assemblePages(stable, beta, join(directory, "bad-site")), /another channel/);
  console.log("Pages checks passed: preserved main bytes, separate beta assets/storage, and invalid-layout refusal.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
