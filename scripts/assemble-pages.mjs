import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function assemblePages(stableDirectory, betaDirectory, outputDirectory) {
  const directories = [stableDirectory, betaDirectory, outputDirectory].map((path) => resolve(path));
  for (let i = 0; i < directories.length; i++) {
    for (let j = i + 1; j < directories.length; j++) {
      assert.ok(directories[i] !== directories[j] &&
        !directories[i].startsWith(`${directories[j]}/`) &&
        !directories[j].startsWith(`${directories[i]}/`), "Pages input/output directories must be separate.");
    }
  }
  // Refuse an existing output instead of accidentally publishing stale files.
  await mkdir(outputDirectory);
  for (const [directory, channel, base] of [
    [stableDirectory, "stable", "/yellow-editor/"],
    [betaDirectory, "beta", "/yellow-editor/beta/"],
  ]) {
    const release = JSON.parse(await readFile(join(directory, "release.json"), "utf8"));
    assert.equal(release.channel, channel);
    assert.equal(release.base, base);
    assert.match(release.sha, /^[a-f0-9]{40}$/);
    assert.equal(release.ref, channel === "stable" ? "main" : "beta");
    const html = await readFile(join(directory, "index.html"), "utf8");
    const assets = [...html.matchAll(/(?:src|href)="([^"\s]+)"/g)]
      .map((match) => match[1]).filter((url) => url.startsWith("/"));
    assert.ok(assets.length > 0, `${channel}: no absolute asset references found`);
    for (const asset of assets) {
      assert.ok(asset.startsWith(base), `${channel}: asset uses another channel's base: ${asset}`);
      const relative = asset.slice(base.length).split(/[?#]/)[0];
      assert.ok(relative && !relative.split("/").includes(".."), `${channel}: invalid asset path`);
      await readFile(join(directory, relative));
    }
    assert.ok(!(await readdir(stableDirectory)).includes("beta"), "Main build already contains a beta directory.");
  }
  await cp(stableDirectory, outputDirectory, { recursive: true, dereference: true });
  await cp(betaDirectory, join(outputDirectory, "beta"), { recursive: true, dereference: true });
  await writeFile(join(outputDirectory, ".nojekyll"), "");
  console.log("Pages artifact verified: main at /yellow-editor/; beta at /yellow-editor/beta/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5, "Usage: assemble-pages.mjs MAIN_DIST BETA_DIST OUTPUT");
  await assemblePages(...process.argv.slice(2));
}
