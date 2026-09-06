// T6 완료 기준: --force 없이 기존 스킬 디렉터리 덮어쓰기 거부 / --out 밖 쓰기 시도 없음 (실제 fs 사용).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssembledFile, Manifest } from "../src/core/index.js";
import {
  FsTargetError,
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFile,
  resolveTargetDir,
  tempSkillDir,
  writeSkill,
} from "../src/adapters/fsTargets.js";

const manifest: Manifest = {
  version: 1,
  createdAt: "2026-09-06T00:00:00.000Z",
  sourceFiles: [],
  sections: [],
  outputs: ["SKILL.md"],
  gate: { skipped: true },
  goldenQa: [],
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

describe("collectInputFiles (DESIGN §6 T8 — 폴더 재귀 확장)", () => {
  it("returns a file path as-is", async () => {
    const path = join(dir, "a.md");
    await writeFile(path, "x");
    expect(await collectInputFiles([path])).toEqual([path]);
  });

  it("recursively collects every file in a folder, skipping .git/node_modules", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "sub", "b.md"), "b");
    await writeFile(join(dir, "node_modules", "pkg", "c.md"), "c");

    const found = await collectInputFiles([dir]);
    expect(found.sort()).toEqual([join(dir, "a.md"), join(dir, "sub", "b.md")].sort());
  });
});

describe("readSkillDir / readManifest (validate/eval/report용)", () => {
  it("reads every file back with a forward-slash relative path", async () => {
    const outDir = join(dir, "skill");
    const nested: AssembledFile[] = [
      ...files,
      { path: "chapters/ch01-a.md", content: "body\n", estimatedTokens: 1 },
    ];
    await writeSkill(outDir, nested, manifest);

    const skillFiles = await readSkillDir(outDir);
    const byPath = new Map(skillFiles.map((f) => [f.path, f.content]));
    expect(byPath.get("SKILL.md")).toBe("# Skill\n");
    expect(byPath.get("chapters/ch01-a.md")).toBe("body\n");
    expect(byPath.get("manifest.json")).toBeDefined();
  });

  it("reads manifest.json back as a validated Manifest", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, files, manifest);
    expect(await readManifest(outDir)).toEqual(manifest);
  });

  it("rejects a manifest.json that fails schema validation", async () => {
    const outDir = join(dir, "skill");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "manifest.json"), JSON.stringify({ not: "a manifest" }));
    await expect(readManifest(outDir)).rejects.toThrow();
  });
});

describe("resolveTargetDir / tempSkillDir (DESIGN §6 T8)", () => {
  it("defaults to ~/.claude/skills/<slug>", () => {
    expect(resolveTargetDir("claude", "my-skill")).toContain(join(".claude", "skills", "my-skill"));
  });

  it("uses ~/.agents/skills/<slug> for the agents target", () => {
    expect(resolveTargetDir("agents", "my-skill")).toContain(join(".agents", "skills", "my-skill"));
  });

  it("creates a fresh, empty, unique temp dir under the OS temp root (mkdtemp)", async () => {
    const a = await tempSkillDir("my-skill");
    const b = await tempSkillDir("my-skill");
    try {
      expect(a).toContain("live-skill-my-skill-");
      expect(a).not.toBe(b);
      expect(await readdir(a)).toEqual([]); // 비어 있으니 force 없이 바로 쓸 수 있다
      expect(join(a, "..")).toBe(join(tmpdir(), "."));
    } finally {
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
    }
  });
});

describe("resolveTargetDir / tempSkillDir — slug 경로 탈출 차단 (A1, 완료 기준)", () => {
  const unsafe = ["../../outside", "a/b", "..", ".", "/abs", "Manual", "a b", "a".repeat(65)];

  it.each(unsafe)("resolveTargetDir refuses unsafe slug %j without touching the fs", (slug) => {
    expect(() => resolveTargetDir("claude", slug)).toThrow(FsTargetError);
    expect(() => resolveTargetDir("claude", slug)).toThrow(/unsafe_slug|refusing slug/u);
  });

  it.each(unsafe)("tempSkillDir refuses unsafe slug %j and creates nothing", async (slug) => {
    const before = (await readdir(tmpdir())).filter((n) => n.startsWith("live-skill-")).length;
    await expect(tempSkillDir(slug)).rejects.toMatchObject({ kind: "unsafe_slug" });
    const after = (await readdir(tmpdir())).filter((n) => n.startsWith("live-skill-")).length;
    expect(after).toBe(before);
  });

  it("a valid slug resolves to a direct child of the skills root, never above it", () => {
    const dir = resolveTargetDir("claude", "my-skill");
    const root = join(dir, "..");
    expect(root.endsWith(join(".claude", "skills"))).toBe(true);
  });
});
