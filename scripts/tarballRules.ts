// Publish tarball check rules (H3, SEC-012·AUD-018), pure functions only. Execution (npm pack, tar,
// file reads) lives in check-tarball.ts.
// The old shell script ran a regex over the human-readable `npm notice 100B .env.production` output
// and missed file names because of the prefix and size columns. Now the structured `files[].path`
// from `npm pack --dry-run --json` is checked, and every text file in the real tgz is scanned for
// key patterns. Keeping the rules as pure functions lets tests/tarballRules.test.ts verify them with
// synthetic lists.

/** package.json `files: ["dist"]` plus the root files npm always adds. Any other path fails (allowlist). */
export function isAllowedPath(path: string): boolean {
  if (path.startsWith("dist/")) return true;
  return ["package.json", "LICENSE", "README.md", "README.ko.md"].includes(path);
}

/** Rules that identify secret/state files by name alone; they apply even inside the allowlist (under dist/). */
export const SECRET_PATH_RULES: readonly { name: string; test: (path: string) => boolean }[] = [
  { name: "env file", test: (p) => /(^|\/)\.env(\..+)?$/u.test(p) },
  { name: "config.json", test: (p) => /(^|\/)config\.json$/u.test(p) },
  { name: ".live-skill/ state", test: (p) => /(^|\/)\.live-skill\//u.test(p) },
  {
    name: "private key file",
    test: (p) => /\.(pem|key|p12|pfx)$/iu.test(p) || /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/u.test(p),
  },
  { name: "npm/git config", test: (p) => /(^|\/)(\.npmrc|\.git|\.github)(\/|$)/u.test(p) },
];

export interface ForbiddenPath {
  path: string;
  reason: string;
}

/** Finds everything in the tarball path list that must not be published (all of them, not just the first, so they can be fixed at once). */
export function findForbiddenPaths(paths: readonly string[]): ForbiddenPath[] {
  const out: ForbiddenPath[] = [];
  for (const path of paths) {
    const secret = SECRET_PATH_RULES.find((r) => r.test(path));
    if (secret !== undefined) out.push({ path, reason: secret.name });
    else if (!isAllowedPath(path)) out.push({ path, reason: "outside the publish allowlist" });
  }
  return out;
}

/** Real key formats only; regex source text and the word "api_key" do not match (a false positive must not block publishing). */
export const KEY_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/u },
  { name: "OpenAI API key", re: /sk-proj-[A-Za-z0-9_-]{20,}/u },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/u },
  {
    name: "GitHub token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/u,
  },
  { name: "Slack token", re: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/u },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
];

/** Names of the key patterns found in the text (deduplicated). */
export function findKeyLikeStrings(text: string): string[] {
  return KEY_PATTERNS.filter((k) => k.re.test(text)).map((k) => k.name);
}

/** A NUL byte within the first 8,000 bytes means binary; the key scan covers text files only. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let i = 0; i < limit; i += 1) if (bytes[i] === 0) return true;
  return false;
}

/** Extracts just the path list from `npm pack --json` output. Returns undefined on any other shape; the caller treats that as a failure. */
export function packedPaths(json: unknown): string[] | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  const first: unknown = json[0];
  if (typeof first !== "object" || first === null || !("files" in first)) return undefined;
  const files = first.files;
  if (!Array.isArray(files)) return undefined;
  const paths: string[] = [];
  for (const f of files as unknown[]) {
    if (typeof f !== "object" || f === null || !("path" in f)) return undefined;
    const path = f.path;
    if (typeof path !== "string") return undefined;
    paths.push(path);
  }
  return paths;
}
