// T6 완료 기준: --force 없이 기존 스킬 디렉터리 덮어쓰기 거부 / --out 밖 쓰기 시도 없음 (실제 fs 사용).
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssembledFile, Manifest } from "../src/core/index.js";
import { sha256Hex } from "../src/core/hash.js";
import {
  FsTargetError,
  INPUT_LIMITS,
  INPUT_READ_CONCURRENCY,
  collectInputFiles,
  readManifest,
  readSkillDir,
  readSourceFile,
  readSourceFiles,
  resolveTargetDir,
  tempSkillDir,
  writeSkill,
  type InputLimits,
} from "../src/adapters/fsTargets.js";

const manifest: Manifest = {
  version: 1,
  createdAt: "2026-09-06T00:00:00.000Z",
  sourceFiles: [],
  sections: [],
  outputs: ["SKILL.md"],
  outputHashes: [{ path: "SKILL.md", sha256: sha256Hex("# Skill\n") }],
  gate: { skipped: true },
  goldenQa: [],
};
const files: AssembledFile[] = [{ path: "SKILL.md", content: "# Skill\n", estimatedTokens: 3 }];
/** E3: outputs와 outputHashes를 같은 파일 집합으로 채운 manifest. */
const manifestFor = (gen: readonly AssembledFile[]): Manifest => ({
  ...manifest,
  outputs: gen.map((f) => f.path),
  outputHashes: gen.map((f) => ({ path: f.path, sha256: sha256Hex(f.content) })),
});

let dir: string;

beforeEach(async () => {
  // A2: collectInputFiles는 실제 경로를 돌려주므로(macOS의 /var → /private/var 같은 루트 링크 해소) 기대값도
  // 실제 경로로 만든다.
  dir = await realpath(await mkdtemp(join(tmpdir(), "live-skill-fstargets-")));
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

  it("hands back a dedicated buffer without an extra copy (D3): the bytes own their whole ArrayBuffer", async () => {
    const path = join(dir, "sample.txt");
    await writeFile(path, "hello");
    const src = await readSourceFile(path);
    expect(src.bytes.byteOffset).toBe(0);
    expect(src.bytes.buffer.byteLength).toBe(src.bytes.byteLength); // 풀 공유 슬라이스가 아니다
  });
});

describe("input size limits (D3, 완료 기준) — 읽기 전 거부 + 수정 방법", () => {
  const tiny: InputLimits = { maxFiles: 2, maxFileBytes: 5, maxTotalBytes: 8 };

  it("ships with the DESIGN §6 D3 constants", () => {
    expect(INPUT_LIMITS).toEqual({
      maxFiles: 500,
      maxFileBytes: 25 * 1024 * 1024,
      maxTotalBytes: 100 * 1024 * 1024,
    });
    expect(INPUT_READ_CONCURRENCY).toBe(4);
  });

  it("collectInputFiles refuses a folder with more than maxFiles files, before opening any", async () => {
    for (const name of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, name), "x");
    await expect(collectInputFiles([dir], tiny)).rejects.toMatchObject({ kind: "too_many_files" });
    await expect(collectInputFiles([dir], tiny)).rejects.toThrow(/more than 2 files.*Fix:/u);
  });

  it("collectInputFiles refuses a single file over maxFileBytes, naming it", async () => {
    await writeFile(join(dir, "ok.md"), "abc");
    await writeFile(join(dir, "big.md"), "123456");
    await expect(collectInputFiles([dir], tiny)).rejects.toMatchObject({ kind: "file_too_large" });
    await expect(collectInputFiles([dir], tiny)).rejects.toThrow(
      /big\.md.*over the per-file limit.*Fix:/u,
    );
  });

  it("collectInputFiles refuses when the files together exceed maxTotalBytes even though each is small", async () => {
    await writeFile(join(dir, "a.md"), "12345");
    await writeFile(join(dir, "b.md"), "12345");
    await expect(collectInputFiles([dir], tiny)).rejects.toMatchObject({ kind: "input_too_large" });
    await expect(collectInputFiles([dir], tiny)).rejects.toThrow(/over the limit.*Fix:/u);
  });

  it("collectInputFiles accepts input exactly at the limits", async () => {
    await writeFile(join(dir, "a.md"), "1234");
    await writeFile(join(dir, "b.md"), "1234");
    expect((await collectInputFiles([dir], tiny)).length).toBe(2);
  });

  it("the pre-read check is stat-only: an unreadable oversized file is refused as too large, not with EACCES", async () => {
    if (process.getuid?.() === 0) return; // root는 권한 비트를 무시한다
    const big = join(dir, "big.md");
    await writeFile(big, "123456", { mode: 0o000 });
    try {
      await expect(collectInputFiles([dir], tiny)).rejects.toMatchObject({
        kind: "file_too_large",
      });
    } finally {
      await chmod(big, 0o600);
    }
  });

  it("readSourceFile re-checks the per-file limit at open time (defence in depth)", async () => {
    const path = join(dir, "big.md");
    await writeFile(path, "123456");
    await expect(readSourceFile(path, tiny)).rejects.toMatchObject({ kind: "file_too_large" });
    expect(new TextDecoder().decode((await readSourceFile(join(dir, "big.md"))).bytes)).toBe(
      "123456",
    ); // 기본 상한으로는 물론 읽힌다
  });

  it("readSourceFiles enforces the running total while reading, keeps input order, and bounds concurrency", async () => {
    await writeFile(join(dir, "a.md"), "12345");
    await writeFile(join(dir, "b.md"), "12345");
    const paths = [join(dir, "b.md"), join(dir, "a.md")];
    await expect(readSourceFiles(paths, { limits: tiny })).rejects.toMatchObject({
      kind: "input_too_large",
    });

    const roomy = { ...tiny, maxTotalBytes: 10 };
    const read = await readSourceFiles(paths, { limits: roomy, concurrency: 1 });
    expect(read.map((s) => s.path)).toEqual(paths);
    await expect(
      readSourceFiles([...paths, join(dir, "a.md")], { limits: roomy }),
    ).rejects.toMatchObject({
      kind: "too_many_files",
    });
  });

  it("readSkillDir goes through the same limits", async () => {
    await writeFile(join(dir, "SKILL.md"), "123456");
    await expect(readSkillDir(dir)).resolves.toHaveLength(1); // 기본 상한 안
    for (const name of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, name), "x");
    expect((await readSkillDir(dir)).length).toBe(4); // 기본 상한(500개)은 충분히 넓다
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

describe("collectInputFiles — symlink boundary (A2, 완료 기준)", () => {
  it("refuses a symlink inside the input root that points at a file outside it", async () => {
    await mkdir(join(dir, "in"));
    await mkdir(join(dir, "outside"));
    await writeFile(join(dir, "outside", "secret.md"), "# not yours");
    await symlink(join(dir, "outside", "secret.md"), join(dir, "in", "link.md"));

    await expect(collectInputFiles([join(dir, "in")])).rejects.toMatchObject({
      kind: "symlink_refused",
    });
    await expect(collectInputFiles([join(dir, "in")])).rejects.toThrow(/link\.md/u);
  });

  it("terminates on a symlink cycle instead of recursing (완료 기준)", async () => {
    await mkdir(join(dir, "in"));
    await writeFile(join(dir, "in", "a.md"), "a");
    await symlink("..", join(dir, "in", "loop")); // in/loop → dir → dir/in → … 옛 코드는 ELOOP까지 돌았다

    await expect(collectInputFiles([join(dir, "in")])).rejects.toMatchObject({
      kind: "symlink_refused",
    });
  });

  it("follows a user-supplied root that is itself a symlink (the root is trusted) and returns real paths", async () => {
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "real", "a.md"), "a");
    await symlink(join(dir, "real"), join(dir, "alias"));

    expect(await collectInputFiles([join(dir, "alias")])).toEqual([join(dir, "real", "a.md")]);
  });

  it("readSourceFile refuses a symlink path (no-follow open)", async () => {
    await writeFile(join(dir, "real.md"), "x");
    await symlink(join(dir, "real.md"), join(dir, "link.md"));
    await expect(readSourceFile(join(dir, "link.md"))).rejects.toMatchObject({
      kind: "symlink_refused",
    });
  });
});

describe("writeSkill — symlink boundary (A2, 완료 기준; A3 이후 의미)", () => {
  // A3 이후 --force는 기존 트리 안에 쓰는 게 아니라 통째로 교체한다. 따라서 안에 놓인 링크는 "거부"가 아니라
  // 이전 세대와 함께 치워지고, 링크 대상은 어떤 경우에도 건드리지 않는다.
  it("never writes through a symlinked subdirectory: with --force the link is replaced, its target untouched", async () => {
    const outDir = join(dir, "skill");
    const elsewhere = join(dir, "elsewhere");
    await mkdir(outDir);
    await mkdir(elsewhere);
    await symlink(elsewhere, join(outDir, "chapters"));
    const withChapter: AssembledFile[] = [
      ...files,
      { path: "chapters/ch01-a.md", content: "body\n", estimatedTokens: 1 },
    ];

    await writeSkill(outDir, withChapter, manifest, { force: true });
    expect(await readdir(elsewhere)).toEqual([]); // 링크 대상엔 아무것도 안 갔다
    expect((await lstat(join(outDir, "chapters"))).isSymbolicLink()).toBe(false); // 링크는 사라지고 진짜 디렉터리
    expect(await readFile(join(outDir, "chapters", "ch01-a.md"), "utf-8")).toBe("body\n");
  });

  it("never writes through a symlinked file: with --force the link is replaced, the victim intact", async () => {
    const outDir = join(dir, "skill");
    const victim = join(dir, "victim.md");
    await mkdir(outDir);
    await writeFile(victim, "keep me");
    await symlink(victim, join(outDir, "SKILL.md"));

    await writeSkill(outDir, files, manifest, { force: true });
    expect(await readFile(victim, "utf-8")).toBe("keep me");
    expect((await lstat(join(outDir, "SKILL.md"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# Skill\n");
  });

  it("without --force a directory containing only a symlink still counts as non-empty and is refused", async () => {
    const outDir = join(dir, "skill");
    await mkdir(outDir);
    await writeFile(join(dir, "victim.md"), "keep me");
    await symlink(join(dir, "victim.md"), join(outDir, "SKILL.md"));
    await expect(writeSkill(outDir, files, manifest)).rejects.toMatchObject({
      kind: "already_exists",
    });
    expect(await readFile(join(dir, "victim.md"), "utf-8")).toBe("keep me");
  });

  it("still writes normally into an outDir that is itself a symlink (the root is trusted)", async () => {
    const real = join(dir, "real-out");
    await mkdir(real);
    await symlink(real, join(dir, "out-link"));
    await writeSkill(join(dir, "out-link"), files, manifest);
    expect(await readFile(join(real, "SKILL.md"), "utf-8")).toBe("# Skill\n");
  });
});

describe("writeSkill — atomic staging swap (A3, 완료 기준)", () => {
  const gen1: AssembledFile[] = [
    { path: "SKILL.md", content: "# v1\n", estimatedTokens: 2 },
    { path: "chapters/ch01-a.md", content: "v1 a\n", estimatedTokens: 2 },
    { path: "chapters/ch02-b.md", content: "v1 b\n", estimatedTokens: 2 },
  ];
  const gen1Manifest: Manifest = manifestFor(gen1);

  async function debris(parent: string): Promise<string[]> {
    return (await readdir(parent)).filter((n) => n.includes(".live-skill-"));
  }

  it("a failure in the middle of writing leaves the previous generation completely intact, with no staging debris", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, gen1, gen1Manifest);

    // 3번째 파일이 실패하게 만든다: 이미 디렉터리로 만들어진 "chapters"를 파일로 열면 EISDIR.
    const gen2Broken: AssembledFile[] = [
      { path: "SKILL.md", content: "# v2\n", estimatedTokens: 2 },
      { path: "chapters/ch01-a.md", content: "v2 a\n", estimatedTokens: 2 },
      { path: "chapters", content: "not a dir", estimatedTokens: 2 },
    ];
    await expect(writeSkill(outDir, gen2Broken, gen1Manifest, { force: true })).rejects.toThrow();

    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# v1\n");
    expect(await readFile(join(outDir, "chapters", "ch01-a.md"), "utf-8")).toBe("v1 a\n");
    expect(await readFile(join(outDir, "chapters", "ch02-b.md"), "utf-8")).toBe("v1 b\n");
    expect(await readManifest(outDir)).toEqual(gen1Manifest);
    expect(await debris(dir)).toEqual([]); // staging도 old도 남지 않는다
  });

  it("--force recompile drops files from the previous generation (no stale chapters)", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, gen1, gen1Manifest);

    const gen2: AssembledFile[] = [
      { path: "SKILL.md", content: "# v2\n", estimatedTokens: 2 },
      { path: "chapters/ch01-a.md", content: "v2 a\n", estimatedTokens: 2 },
    ];
    const gen2Manifest: Manifest = manifestFor(gen2);
    await writeSkill(outDir, gen2, gen2Manifest, { force: true });

    expect(await readdir(join(outDir, "chapters"))).toEqual(["ch01-a.md"]);
    expect((await readSkillDir(outDir)).map((f) => f.path).sort()).toEqual([
      "SKILL.md",
      "chapters/ch01-a.md",
      "manifest.json",
    ]);
    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# v2\n");
    expect(await debris(dir)).toEqual([]);
  });

  it("creates missing parent directories and leaves no staging debris on success", async () => {
    const outDir = join(dir, "a", "b", "skill");
    await writeSkill(outDir, files, manifest);
    expect(await readFile(join(outDir, "SKILL.md"), "utf-8")).toBe("# Skill\n");
    expect(await debris(join(dir, "a", "b"))).toEqual([]);
  });

  it("a refused write (non-empty, no --force) leaves the existing generation and no debris", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, gen1, gen1Manifest);
    await expect(writeSkill(outDir, files, manifest)).rejects.toMatchObject({
      kind: "already_exists",
    });
    expect(await readFile(join(outDir, "chapters", "ch02-b.md"), "utf-8")).toBe("v1 b\n");
    expect(await debris(dir)).toEqual([]);
  });
});

describe("readSkillDir / readManifest — symlink boundary (A2)", () => {
  it("refuses a skill dir that contains a symlink", async () => {
    const outDir = join(dir, "skill");
    await writeSkill(outDir, files, manifest);
    await writeFile(join(dir, "outside.md"), "x");
    await symlink(join(dir, "outside.md"), join(outDir, "extra.md"));
    await expect(readSkillDir(outDir)).rejects.toMatchObject({ kind: "symlink_refused" });
  });

  it("refuses a manifest.json that is a symlink", async () => {
    const outDir = join(dir, "skill");
    await mkdir(outDir);
    await writeFile(join(dir, "real-manifest.json"), JSON.stringify(manifest));
    await symlink(join(dir, "real-manifest.json"), join(outDir, "manifest.json"));
    await expect(readManifest(outDir)).rejects.toMatchObject({ kind: "symlink_refused" });
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
