import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const app = await readFile("src/App.tsx", "utf8");
const readme = await readFile("README.md", "utf8");
const server = await readFile("beach/server.mjs", "utf8");
const docker = await readFile("beach/Dockerfile", "utf8");
const dockerignore = await readFile("beach/Dockerfile.dockerignore", "utf8");

assert.doesNotMatch(app, /beach\/index\.html|Pikachu[’']s Beach/, "Editor still links to trainer");
assert.doesNotMatch(readme, /Pikachu[’']s Beach link/, "Editor README still advertises trainer page");
assert.doesNotMatch(server, /\.\.\/public\/beach/, "Trainer still loads editor public assets");
assert.match(server, /\.\/viewer\/\$\{file\}/, "Trainer does not serve its private viewer");
assert.match(docker, /COPY beach\/viewer\//, "Docker image lacks standalone viewer");
assert.match(dockerignore, /!beach\/viewer\/agent-preview\.webm/, "Docker context omits viewer preview");
for (const file of ["index.html", "style.css", "viewer.js", "agent-preview.webm"]) {
  await access(`beach/viewer/${file}`);
  await assert.rejects(access(`public/beach/${file}`), { code: "ENOENT" });
}
console.log("Beach isolation checks passed: no editor link or public page; standalone server assets retained.");
