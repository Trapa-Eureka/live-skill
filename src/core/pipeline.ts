// 컴파일 파이프라인 — extract → outline → distill → assemble → validate (DESIGN §1, §5.1).
// 게이트(§4)는 아직 연결하지 않는다(T7이 붙인다) — manifest.gate는 항상 {skipped:true}.
// 순수 오케스트레이션: 실제 파일 읽기/쓰기는 호출자(어댑터)가 SourceFile[]로 넘기고 반환값을 받아간다.
import { extractAnchors } from "./anchors.js";
import { assembleSkill, chapterFilePath, type AssembledFile } from "./assembler.js";
import type { Config } from "./config.js";
import { sha256Hex } from "./hash.js";
import { distillPrompt, outlinePrompt } from "./prompts.js";
import { err, ok, type Result } from "./result.js";
import { skillPlanSchema } from "./schemas.js";
import { slugifyHeading } from "./sectionId.js";
import { estimateTokens } from "./tokenEstimate.js";
import type {
  Clock,
  DistilledChapter,
  DocumentExtractor,
  ExtractError,
  LlmProvider,
  Manifest,
  Section,
  SkillPlan,
} from "./types.js";
import { validateSkill, type ValidationReport } from "./validator.js";

export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  /** 없으면 "application/octet-stream" — 확장자 기반 라우팅으로 폴백(adapters/extractors/route.ts). */
  mime?: string;
}

export const MAX_INPUT_TOKENS = 30_000;

export type PipelineError =
  | { kind: "unsupported_format"; path: string; message: string }
  | { kind: "extract_failed"; path: string; error: ExtractError; message: string }
  | { kind: "empty_input"; message: string }
  | { kind: "input_too_large"; estimatedTokens: number; limit: number; message: string }
  | { kind: "outline_invalid"; detail: string; message: string }
  | { kind: "call_cap_exceeded"; estimated: number; limit: number; message: string }
  | { kind: "assemble_failed"; detail: string; message: string };

export interface CompileResult {
  manifest: Manifest;
  files: AssembledFile[];
  validation: ValidationReport;
}

interface PerFileSections {
  path: string;
  sections: Section[];
}

interface NamedSection extends Section {
  sourcePath: string;
}

const SUPPORTED_FORMATS = "PDF(텍스트형)·DOCX·MD/TXT·HTML";

function baseNameWithoutExt(path: string): string {
  const last = path.split(/[\\/]/u).pop() ?? path;
  return last.replace(/\.[^./\\]+$/u, "");
}

/** 소스가 여러 개면 파일명 슬러그로 섹션 id 접두어를 붙여 충돌을 막는다(DESIGN §5.1). */
function namespaceSections(perFile: readonly PerFileSections[]): NamedSection[] {
  if (perFile.length <= 1) {
    return perFile.flatMap(({ path, sections }) =>
      sections.map((s) => ({ ...s, sourcePath: path })),
    );
  }
  return perFile.flatMap(({ path, sections }) => {
    const prefix = slugifyHeading(baseNameWithoutExt(path));
    return sections.map((s) => ({ ...s, id: `${prefix}/${s.id}`, sourcePath: path }));
  });
}

async function extractAll(
  sources: readonly SourceFile[],
  extractors: readonly DocumentExtractor[],
): Promise<Result<PerFileSections[], PipelineError>> {
  const perFile: PerFileSections[] = [];
  for (const src of sources) {
    const mime = src.mime ?? "application/octet-stream";
    const extractor = extractors.find((e) => e.supports(mime, src.path));
    if (extractor === undefined) {
      return err({
        kind: "unsupported_format",
        path: src.path,
        message: `"${src.path}": unsupported format. Fix: use one of ${SUPPORTED_FORMATS}.`,
      });
    }
    const result = await extractor.extract(src.bytes);
    if (!result.ok) {
      const fix =
        result.error.kind === "empty_text"
          ? "the document has no extractable text — check it isn't a scanned image (OCR is not supported in v0.1)."
          : "the file may be corrupt or password-protected — try re-exporting it.";
      return err({
        kind: "extract_failed",
        path: src.path,
        error: result.error,
        message: `"${src.path}": extraction failed (${result.error.kind}). Fix: ${fix}`,
      });
    }
    perFile.push({ path: src.path, sections: result.value.sections });
  }
  return ok(perFile);
}

export interface PipelineDeps {
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  clock: Clock;
  config: Config;
}

/** DESIGN §5.1의 전체 파이프라인. LLM은 outline 1회 + 챕터당 distill 1회만 부른다(게이트 제외). */
export async function compile(
  sources: readonly SourceFile[],
  deps: PipelineDeps,
): Promise<Result<CompileResult, PipelineError>> {
  if (sources.length === 0) {
    return err({
      kind: "empty_input",
      message: "no source files given. Fix: pass at least one file, folder, or glob.",
    });
  }

  const extracted = await extractAll(sources, deps.extractors);
  if (!extracted.ok) return extracted;

  const sections = namespaceSections(extracted.value);
  if (sections.length === 0) {
    return err({
      kind: "empty_input",
      message: "every source file produced zero sections. Fix: check the source content.",
    });
  }

  const totalTokens = sections.reduce((n, s) => n + estimateTokens(s.text), 0);
  if (totalTokens > MAX_INPUT_TOKENS) {
    return err({
      kind: "input_too_large",
      estimatedTokens: totalTokens,
      limit: MAX_INPUT_TOKENS,
      message: `input is ~${String(totalTokens)} tokens, over the ${String(MAX_INPUT_TOKENS)}-token single-compile limit. Fix: split the source into smaller files/folders and compile them separately.`,
    });
  }

  const outlineReq = outlinePrompt({ sections });
  const outlineRaw = await deps.llm.complete(outlineReq);
  let plan: SkillPlan;
  try {
    plan = skillPlanSchema.parse(JSON.parse(outlineRaw) as unknown);
  } catch (e) {
    return err({
      kind: "outline_invalid",
      detail: e instanceof Error ? e.message : "unknown",
      message:
        "the outline step returned a response that doesn't match the expected schema. Fix: retry, or check the outline prompt/model.",
    });
  }

  const totalCalls = 1 + plan.chapters.length;
  if (totalCalls > deps.config.maxLlmCalls) {
    return err({
      kind: "call_cap_exceeded",
      estimated: totalCalls,
      limit: deps.config.maxLlmCalls,
      message: `compiling would take ~${String(totalCalls)} LLM calls (1 outline + ${String(plan.chapters.length)} chapters), over the MAX_LLM_CALLS cap of ${String(deps.config.maxLlmCalls)}. Fix: split the source so it plans into fewer chapters, or raise MAX_LLM_CALLS.`,
    });
  }

  const byId = new Map(sections.map((s) => [s.id, s]));
  const distilled: DistilledChapter[] = [];
  for (const chapter of plan.chapters) {
    const chapterSections = chapter.sectionIds
      .map((id) => byId.get(id))
      .filter((s): s is NamedSection => s !== undefined);
    const req = distillPrompt(chapter, chapterSections, deps.config.budgets.chapter);
    const body = await deps.llm.complete(req);
    distilled.push({ id: chapter.id, file: "", body, anchors: extractAnchors(body) });
  }

  let files: AssembledFile[];
  try {
    files = assembleSkill(plan, distilled, { verified: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "assembly failed for an unknown reason.";
    return err({ kind: "assemble_failed", detail: message, message });
  }

  const validation = validateSkill(files, deps.config.budgets);

  const sourceHashes = sources.map((s) => ({ path: s.path, sha256: sha256Hex(s.bytes) }));
  const manifestSections = plan.chapters.flatMap((chapter, i) =>
    chapter.sectionIds.map((id) => ({
      id,
      sha256: sha256Hex(byId.get(id)?.text ?? ""),
      chapterFile: chapterFilePath(i, chapter.title),
    })),
  );

  const manifest: Manifest = {
    version: 1,
    createdAt: deps.clock.now().toISOString(),
    sourceFiles: sourceHashes,
    sections: manifestSections,
    outputs: files.map((f) => f.path),
    gate: { skipped: true },
  };

  return ok({ manifest, files, validation });
}
