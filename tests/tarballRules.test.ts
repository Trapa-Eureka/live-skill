// H3(SEC-012·AUD-018): tarball 검사 규칙 — 합성 경로 목록·문자열로 검증한다(순수 함수, npm·네트워크 0건).
import { describe, expect, it } from "vitest";
import {
  findForbiddenPaths,
  findKeyLikeStrings,
  isProbablyBinary,
  packedPaths,
} from "../scripts/tarballRules.js";

describe("findForbiddenPaths", () => {
  it("accepts exactly the publish set: dist/** plus the root files npm always adds", () => {
    expect(
      findForbiddenPaths([
        "package.json",
        "LICENSE",
        "README.md",
        "README.ko.md",
        "dist/cli/index.js",
        "dist/core/pipeline.d.ts",
      ]),
    ).toEqual([]);
  });

  it("catches the synthetic .env.production entry the old regex missed, and every other env variant", () => {
    const found = findForbiddenPaths([
      ".env.production",
      ".env.staging",
      ".env",
      ".env.local",
      ".env.example",
      "dist/.env",
      "dist/config/.env.prod",
    ]);
    expect(found.map((f) => f.path)).toEqual([
      ".env.production",
      ".env.staging",
      ".env",
      ".env.local",
      ".env.example",
      "dist/.env",
      "dist/config/.env.prod",
    ]);
    expect(new Set(found.map((f) => f.reason))).toEqual(new Set(["env file"]));
  });

  it("names the rule for other secret/state files, nested or not", () => {
    expect(findForbiddenPaths(["config.json", "dist/config.json"]).map((f) => f.reason)).toEqual([
      "config.json",
      "config.json",
    ]);
    expect(findForbiddenPaths([".live-skill/state.json"])[0]?.reason).toBe(".live-skill/ state");
    expect(
      findForbiddenPaths(["dist/server.pem", "id_rsa", "dist/keys/id_ed25519"]).map(
        (f) => f.reason,
      ),
    ).toEqual(["private key file", "private key file", "private key file"]);
    expect(
      findForbiddenPaths([".npmrc", ".git/config", ".github/workflows/ci.yml"]).map(
        (f) => f.reason,
      ),
    ).toEqual(["npm/git config", "npm/git config", "npm/git config"]);
  });

  it("refuses anything outside the allowlist even when it is not a secret (files whitelist regression)", () => {
    const found = findForbiddenPaths([
      "tests/cli.test.ts",
      "src/core/pipeline.ts",
      "fixtures/docs/manual.md",
      "scripts/smoke.ts",
    ]);
    expect(found).toHaveLength(4);
    expect(new Set(found.map((f) => f.reason))).toEqual(new Set(["outside the publish allowlist"]));
  });

  it("reports every offending file, not just the first", () => {
    expect(findForbiddenPaths([".env.production", "dist/ok.js", "tests/x.ts"])).toHaveLength(2);
  });
});

describe("findKeyLikeStrings", () => {
  it("finds real key formats", () => {
    expect(findKeyLikeStrings("key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123")).toEqual([
      "Anthropic API key",
    ]);
    expect(findKeyLikeStrings("AKIAABCDEFGHIJKLMNOP and ghp_" + "a".repeat(36))).toEqual([
      "AWS access key id",
      "GitHub token",
    ]);
    expect(findKeyLikeStrings("-----BEGIN RSA PRIVATE KEY-----")).toEqual(["private key block"]);
  });

  it("does not flag the sanitizer's own regex source or the word api_key in shipped code", () => {
    const shipped =
      "const CREDENTIAL_FIELD = /\\b(api[_-]?key|authorization|bearer|token)\\b(\\s*[:=]\\s*)(?:bearer\\s+)?\\S+/giu; const KEY_LIKE = /\\bsk-[A-Za-z0-9_-]{8,}/gu;";
    expect(findKeyLikeStrings(shipped)).toEqual([]);
    expect(findKeyLikeStrings("ANTHROPIC_API_KEY must be set")).toEqual([]);
  });
});

describe("isProbablyBinary / packedPaths", () => {
  it("treats a NUL byte in the head as binary and plain text as text", () => {
    expect(isProbablyBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
    expect(isProbablyBinary(new TextEncoder().encode("export const x = 1;\n"))).toBe(false);
    expect(isProbablyBinary(new Uint8Array())).toBe(false);
  });

  it("extracts files[].path from npm pack --json and rejects other shapes", () => {
    expect(packedPaths([{ files: [{ path: "dist/a.js", size: 1 }, { path: "LICENSE" }] }])).toEqual(
      ["dist/a.js", "LICENSE"],
    );
    expect(packedPaths([])).toBeUndefined();
    expect(packedPaths({ files: [] })).toBeUndefined();
    expect(packedPaths([{ files: [{ size: 1 }] }])).toBeUndefined();
    expect(packedPaths([{ files: "nope" }])).toBeUndefined();
  });
});
