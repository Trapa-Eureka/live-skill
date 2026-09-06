// T6 완료 기준: --force 없이 기존 스킬 디렉터리 덮어쓰기 거부 / --out 밖 쓰기 시도 없음 (실제 fs 사용).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssembledFile, Manifest } from "../src/core/index.js";
import { FsTargetError, readSourceFile, writeSkill } from "../src/adapters/fsTargets.js";

const manifest: Manifest = {
  version: 1,
  createdAt: "2026-09-06T00:00:00.000Z",
  sourceFiles: [],
  sections: [],
  outputs: ["SKILL.md"],
  gate: { skipped: true },
};
const files: AssembledFile[] = [{ path: "SKILL.md", content: "# Skill\n", estimatedTokens: 3 }];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "live-skill-fstargets-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeSkill — happy path", () => {
  it("writes every AssembledFile plus manifest.json under outDir", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, files, manifest);
    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# Skill\n");
    const written = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf-8")) as Manifest;
    expect(written).toEqual(manifest);
  });

  it("creates nested directories for chapter files", async () => {
    const outDir = join(dir, "skill");
    const nested: AssembledFile[] = [
      ...files,
      { path: "chapters/ch01-a.md", content: "body\n", estimatedTokens: 1 },
    ];
    await writeSkill(outDir, nested, manifest);
    expect(await readFile(join(outDir, "chapters/ch01-a.md"), "utf-8")).toBe("body\n");
  });
});

describe("writeSkill — --force boundary (가드레일 5, 완료 기준)", () => {
  it("refuses to write into a non-empty directory without force", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, files, manifest); // 첫 컴파일
    await expect(writeSkill(outDir, files, manifest)).rejects.toThrow(FsTargetError);
    await expect(writeSkill(outDir, files, manifest)).rejects.toMatchObject({
      kind: "already_exists",
    });
  });

  it("overwrites a non-empty directory when force is true", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, files, manifest);
    const updated: AssembledFile[] = [
      { path: "SKILL.md", content: "# Updated\n", estimatedTokens: 3 },
    ];
    await writeSkill(outDir, updated, manifest, { force: true });
    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# Updated\n");
  });

  it("writes into an already-existing but empty directory without force", async () => {
    const outDir = join(dir, "already-there");
    await mkdir(outDir, { recursive: true });
    await writeSkill(outDir, files, manifest);
    expect(await readdir(outDir)).toContain("SKILL.md");
  });
});

describe("writeSkill — out-dir escape (가드레일 5, 완료 기준)", () => {
  it("refuses a file path that would resolve outside outDir, before writing anything", async () => {
    const outDir = join(dir, "skill");
    const escaping: AssembledFile[] = [
      { path: "../../etc/evil.md", content: "x", estimatedTokens: 1 },
    ];
    await expect(writeSkill(outDir, escaping, manifest)).rejects.toThrow(FsTargetError);
    await expect(writeSkill(outDir, escaping, manifest)).rejects.toMatchObject({
      kind: "escapes_out_dir",
    });
    // 거부는 첫 파일에서 일어나므로 outDir 자체가 아예 만들어지지 않는다.
    await expect(readdir(outDir)).rejects.toThrow();
  });
});

describe("readSourceFile", () => {
  it("reads a real file's bytes with its path", async () => {
    const path = join(dir, "sample.txt");
    await writeFile(path, "hello");
    const src = await readSourceFile(path);
    expect(src.path).toBe(path);
    expect(new TextDecoder().decode(src.bytes)).toBe("hello");
  });
});
