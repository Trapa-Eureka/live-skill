// 배포 tarball 검사 규칙(H3, SEC-012·AUD-018) — 순수 함수만. 실행(npm pack·tar·파일 읽기)은 check-tarball.ts.
// 예전 셸 스크립트는 사람이 읽는 `npm notice 100B .env.production` 출력에 정규식을 걸어 접두사·크기 때문에 파일명을
// 놓쳤다. 이제 `npm pack --dry-run --json`의 구조화된 `files[].path`를 검사하고, 실제 tgz의 텍스트 파일 전부를
// 키 패턴으로 훑는다. 규칙을 순수 함수로 두어 tests/tarballRules.test.ts가 합성 목록으로 검증한다.

/** package.json `files: ["dist"]` + npm이 항상 넣는 루트 파일. 이 밖의 경로는 무엇이든 실패다(화이트리스트). */
export function isAllowedPath(path: string): boolean {
  if (path.startsWith("dist/")) return true;
  return ["package.json", "LICENSE", "README.md", "README.ko.md"].includes(path);
}

/** 이름만으로 비밀·상태 파일임을 아는 규칙 — 허용 목록 안(dist/ 아래)이라도 걸린다. */
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

/** tarball에 들어갈 경로 목록에서 배포하면 안 되는 것을 전부 찾는다(첫 것만이 아니라 전부 — 한 번에 고치게). */
export function findForbiddenPaths(paths: readonly string[]): ForbiddenPath[] {
  const out: ForbiddenPath[] = [];
  for (const path of paths) {
    const secret = SECRET_PATH_RULES.find((r) => r.test(path));
    if (secret !== undefined) out.push({ path, reason: secret.name });
    else if (!isAllowedPath(path)) out.push({ path, reason: "outside the publish allowlist" });
  }
  return out;
}

/** 실제 키 형식만 — 정규식 소스 텍스트나 "api_key"라는 단어에는 반응하지 않는다(오탐으로 배포를 막지 않기 위해). */
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

/** 텍스트에서 발견된 키 패턴의 이름들(중복 없이). */
export function findKeyLikeStrings(text: string): string[] {
  return KEY_PATTERNS.filter((k) => k.re.test(text)).map((k) => k.name);
}

/** 앞 8,000바이트 안에 NUL이 있으면 바이너리로 본다 — 키 스캔은 텍스트 파일에만. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let i = 0; i < limit; i += 1) if (bytes[i] === 0) return true;
  return false;
}

/** `npm pack --json` 출력에서 경로 목록만 뽑는다. 형태가 다르면 undefined — 호출자가 실패 처리한다. */
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
