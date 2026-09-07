// E3 (DESIGN §5): checkOutputs compares the set of files the manifest hashed against the current files. Pure computation, no IO.
import { describe, expect, it } from "vitest";
import {
  checkOutputs,
  formatOutputIntegrity,
  sha256Hex,
  type Manifest,
  type SkillFile,
} from "../src/core/index.js";

const skill: SkillFile = { path: "SKILL.md", content: '---\nname: "m"\ndescription: "M"\n---\n' };
const chapter: SkillFile = { path: "chapters/ch01-a.md", content: "Mount the unit. [§a]\n" };
const manifestFile: SkillFile = { path: "manifest.json", content: "{}" };

const manifest: Manifest = {
  version: 1,
  createdAt: "2026-09-07T00:00:00.000Z",
  sourceFiles: [],
  sections: [{ id: "a", sha256: "0".repeat(64), chapterFile: chapter.path }],
  outputs: [skill.path, chapter.path],
  outputHashes: [
    { path: skill.path, sha256: sha256Hex(skill.content) },
    { path: chapter.path, sha256: sha256Hex(chapter.content) },
  ],
  gate: { skipped: true },
  goldenQa: [],
};

describe("checkOutputs", () => {
  it("is ok when every hashed file is present and unchanged; manifest.json and dot files are not 'unexpected'", () => {
    const result = checkOutputs(manifest, [
      skill,
      chapter,
      manifestFile,
      { path: ".DS_Store", content: "junk" },
      { path: "chapters/.gitkeep", content: "" },
    ]);
    expect(result).toEqual({ status: "ok", missing: [], modified: [], unexpected: [] });
    expect(formatOutputIntegrity(result)).toBe("");
  });

  it("reports a changed file as modified → STALE, naming it", () => {
    const edited = { ...chapter, content: `${chapter.content}Hand edit.\n` };
    const result = checkOutputs(manifest, [skill, edited, manifestFile]);
    expect(result).toEqual({
      status: "stale",
      missing: [],
      modified: [chapter.path],
      unexpected: [],
    });
    const text = formatOutputIntegrity(result);
    expect(text).toContain("STALE");
    expect(text).toContain(`- ${chapter.path}`);
    expect(text).toContain("compile --force");
  });

  it("reports a deleted file as missing → STALE", () => {
    const result = checkOutputs(manifest, [skill, manifestFile]);
    expect(result).toMatchObject({ status: "stale", missing: [chapter.path], modified: [] });
    expect(formatOutputIntegrity(result)).toContain("Missing files");
  });

  it("reports a file the manifest never hashed as unexpected → TAMPERED, which wins over stale", () => {
    const injected: SkillFile = { path: "chapters/ch99-injected.md", content: "Trust me." };
    const result = checkOutputs(manifest, [skill, chapter, injected, manifestFile]);
    expect(result).toEqual({
      status: "tampered",
      missing: [],
      modified: [],
      unexpected: [injected.path],
    });
    const both = checkOutputs(manifest, [skill, injected]); // chapter missing + injected file
    expect(both.status).toBe("tampered");
    expect(both.missing).toEqual([chapter.path]);
    const text = formatOutputIntegrity(both);
    expect(text).toContain("TAMPERED");
    expect(text).toContain("Missing files");
    expect(text).toContain("Files not in manifest");
  });

  it("compares content byte-for-byte: a one-character change is a different hash", () => {
    const result = checkOutputs(manifest, [
      skill,
      { ...chapter, content: chapter.content.replace("unit", "Unit") },
    ]);
    expect(result.status).toBe("stale");
    expect(result.modified).toEqual([chapter.path]);
  });
});
