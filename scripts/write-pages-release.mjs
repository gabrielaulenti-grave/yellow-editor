import { writeFile } from "node:fs/promises";

const { VITE_RELEASE_CHANNEL: channel, PAGES_BASE: base, PAGES_REF: ref, PAGES_SHA: sha } = process.env;
if (!["stable", "beta"].includes(channel) || !/^\/[a-zA-Z0-9/_-]+\/$/.test(base ?? "") ||
    !ref || !/^[a-f0-9]{40}$/.test(sha ?? "")) {
  throw new Error("Missing or invalid Pages channel/revision metadata.");
}
await writeFile("dist/release.json", `${JSON.stringify({ channel, base, ref, sha }, null, 2)}\n`);
