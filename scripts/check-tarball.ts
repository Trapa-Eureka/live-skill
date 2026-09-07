#!/usr/bin/env node
// npm publish tarball check (H3, SEC-012·AUD-018; the last line of defense for guardrail 7). Run by
// `npm run check:tarball` / prepublishOnly / CI.
//   1) files[].path from `npm pack --dry-run --json`: fail on anything outside the allowlist
//      (dist/ + root files) or any secret/state file.
//   2) Unpack the real tgz into a temporary directory and scan every text file for key patterns.
// Command, parsing, and read errors all end in "publish blocked": a check that could not run must
// never look like a pass.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  findForbiddenPaths,
  findKeyLikeStrings,
  isProbablyBinary,
  packedPaths,
} from "./tarballRules.js";

function blocked(message: string): never {
  console.error(`publish blocked: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: readonly string[]): string {
  try {
    return execFileSync(cmd, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return blocked(
      `\`${cmd} ${args.join(" ")}\` failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return blocked("npm pack --json did not return JSON");
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// 1) Structured path list
const paths = packedPaths(parseJson(run("npm", ["pack", "--dry-run", "--json"])));
if (paths === undefined) blocked("npm pack --json had an unexpected shape (no files[].path)");
const forbidden = findForbiddenPaths(paths);
if (forbidden.length > 0) {
  for (const f of forbidden) console.error(`  ${f.path}  (${f.reason})`);
  blocked(
    `${String(forbidden.length)} file(s) must not be published — fix package.json "files" or delete them`,
  );
}

// 2) Scan every text file in the real tarball
const tmp = mkdtempSync(join(tmpdir(), "live-skill-tarball-"));
try {
  const packed = packedPaths(parseJson(run("npm", ["pack", "--pack-destination", tmp, "--json"])));
  if (packed === undefined) blocked("npm pack (real) had an unexpected shape");
  const tgz = readdirSync(tmp).find((n) => n.endsWith(".tgz"));
  if (tgz === undefined) blocked("npm pack produced no .tgz");
  run("tar", ["-xzf", join(tmp, tgz), "-C", tmp]);
  const root = join(tmp, "package");
  let scanned = 0;
  const hits: string[] = [];
  for (const file of walk(root)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch (e) {
      blocked(
        `could not read ${relative(root, file)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (isProbablyBinary(bytes)) continue;
    scanned += 1;
    for (const name of findKeyLikeStrings(bytes.toString("utf8"))) {
      hits.push(`${relative(root, file)}: ${name}`);
    }
  }
  if (hits.length > 0) {
    for (const h of hits) console.error(`  ${h}`);
    blocked("key-like string(s) found inside the tarball");
  }
  console.log(
    `tarball check ok: ${String(paths.length)} files inside the allowlist, no secret files, no key-like strings in ${String(scanned)} text files`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
