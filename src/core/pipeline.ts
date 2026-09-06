// 컴파일 파이프라인 — extract → outline → distill → assemble → validate → gate (DESIGN §1, §5.1).
// 순수 오케스트레이션: 실제 파일 읽기/쓰기는 호출자(어댑터)가 SourceFile[]로 넘기고 반환값을 받아간다.
import { extractAnchors } from "./anchors.js";
import { assembleSkill, chapterFilePath, type AssembledFile } from "./assembler.js";
import type { Config } from "./config.js";
import { LlmCallCapError, trackCost } from "./costTracker.js";
import { estimateGateCalls, runGate, type GateChapter } from "./gate.js";
import { sha256Hex } from "./hash.js";
import {
  checkOutlineCoverage,
  formatOutlineCoverageIssues,
  isSubstantiveSection,
} from "./outlineCoverage.js";
import { stripControlChars } from "./modelText.js";
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
  GateReport,
  GoldenQA,
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
  | {
      kind: "call_cap_exceeded";
      /** preflight: 사전 추정이 상한을 넘음(호출 전). runtime: 실행 중 실제 호출 수가 상한에 닿음(D1). */
      stage: "preflight" | "runtime";
      /** preflight면 추정 상한선, runtime이면 상한에 닿기까지 실제로 일어난 호출 수. */
      estimated: number;
      limit: number;
      message: string;
    }
  | { kind: "assemble_failed"; detail: string; message: string };

export interface CompileResult {
  manifest: Manifest;
  files: AssembledFile[];
  validation: ValidationReport;
  /** outline이 만든 슬러그 — --out 없이 --target만 줬을 때 CLI가 타깃 경로를 계산하는 데 쓴다(DESIGN §5.1 T8 결정). */
  slug: string;
  /** 이번 컴파일이 실제로 한 LLM 호출 수(D1) — 사전 추정이 아니라 실측. */
  llmCalls: number;
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
  /** 기본 "run". "skip"은 `--no-gate`에 대응 — manifest.gate = {skipped:true}, SKILL.md에 unverified 표시. */
  gate?: "run" | "skip";
}

/** DESIGN §5.1의 전체 파이프라인: extract→outline→distill→assemble→validate→gate. */
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

  // 검증 모집단(B1): 본문 있는 섹션 전부. 본문 없는 헤딩은 outline에 보여주지도, 배정을 요구하지도 않는다.
  const sections = namespaceSections(extracted.value).filter(isSubstantiveSection);
  if (sections.length === 0) {
    return err({
      kind: "empty_input",
      message:
        "every source file produced zero sections with body text. Fix: check the source content.",
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

  // D1(가드레일 6): 사전 추정과 별개로 실제 호출 수를 세고, 상한을 넘기는 호출은 일어나기 전에 막는다.
  const tracked = trackCost(deps.llm, { maxCalls: deps.config.maxLlmCalls });
  const llm = tracked.llm;
  async function guarded<T>(work: () => Promise<T>): Promise<Result<T, PipelineError>> {
    try {
      return ok(await work());
    } catch (e) {
      if (!(e instanceof LlmCallCapError)) throw e;
      return err({
        kind: "call_cap_exceeded",
        stage: "runtime",
        estimated: e.calls,
        limit: e.limit,
        message: `stopped mid-run: ${String(e.calls)} LLM calls were made and the next one would exceed the MAX_LLM_CALLS cap of ${String(e.limit)}. Nothing was written. Fix: split the source, pass --no-gate, or raise MAX_LLM_CALLS.`,
      });
    }
  }

  const outlineRes = await guarded(() => llm.complete(outlinePrompt({ sections })));
  if (!outlineRes.ok) return outlineRes;
  const outlineRaw = outlineRes.value;
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

  // B1: 계획이 모집단을 정확히 한 번씩 덮는지 — 빠진 섹션은 증류·manifest·게이트에서 조용히 사라졌었다.
  const coverage = checkOutlineCoverage(plan, sections);
  if (coverage !== undefined) {
    const detail = formatOutlineCoverageIssues(coverage);
    return err({
      kind: "outline_invalid",
      detail,
      message: `the outline does not cover the source exactly once (${detail}). Fix: retry — every section with body text must be assigned to exactly one chapter, only known section ids may be used, and chapter ids must be unique.`,
    });
  }

  const runsGate = (deps.gate ?? "run") === "run";
  const gateCallEstimate = runsGate
    ? estimateGateCalls(sections.length, deps.config.qaPerSection)
    : 0;
  const totalCalls = 1 + plan.chapters.length + gateCallEstimate;
  if (totalCalls > deps.config.maxLlmCalls) {
    return err({
      kind: "call_cap_exceeded",
      stage: "preflight",
      estimated: totalCalls,
      limit: deps.config.maxLlmCalls,
      message: `compiling would take up to ~${String(totalCalls)} LLM calls (1 outline + ${String(plan.chapters.length)} chapters + up to ${String(gateCallEstimate)} for the quality gate, counting one qaGen retry per section), over the MAX_LLM_CALLS cap of ${String(deps.config.maxLlmCalls)}. Fix: split the source, pass --no-gate, or raise MAX_LLM_CALLS.`,
    });
  }

  const byId = new Map(sections.map((s) => [s.id, s]));
  const distilled: DistilledChapter[] = [];
  const distillRes = await guarded(async () => {
    for (const chapter of plan.chapters) {
      const chapterSections = chapter.sectionIds
        .map((id) => byId.get(id))
        .filter((s): s is NamedSection => s !== undefined);
      const req = distillPrompt(chapter, chapterSections, deps.config.budgets.chapter);
      // C1: 증류 본문은 파일에 그대로 쓰이는 모델 출력 — 개행·탭 외 제어문자는 여기서 지운다.
      const body = stripControlChars(await llm.complete(req));
      distilled.push({ id: chapter.id, file: "", body, anchors: extractAnchors(body) });
    }
  });
  if (!distillRes.ok) return distillRes;

  function assemble(verified: boolean): Result<AssembledFile[], PipelineError> {
    try {
      return ok(assembleSkill(plan, distilled, { verified }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "assembly failed for an unknown reason.";
      return err({ kind: "assemble_failed", detail: message, message });
    }
  }

  const firstAssembly = assemble(false); // 게이트가 읽을 조립본 — verified 값은 게이트 판정에 영향 없음
  if (!firstAssembly.ok) return firstAssembly;

  let gate: GateReport | { skipped: true };
  let goldenQa: GoldenQA[];
  let files: AssembledFile[];
  if (runsGate) {
    const gateChapters: GateChapter[] = plan.chapters.map((c, i) => ({
      file: chapterFilePath(i, c.title),
      sectionIds: c.sectionIds,
    }));
    const outcomeRes = await guarded(() =>
      runGate(
        { files: firstAssembly.value, chapters: gateChapters, sections },
        { llm, k: deps.config.qaPerSection, threshold: deps.config.gateThreshold },
      ),
    );
    if (!outcomeRes.ok) return outcomeRes;
    const outcome = outcomeRes.value;
    gate = outcome.report;
    goldenQa = outcome.goldenQa;
    // 순수 함수라 verified 값이 확정된 뒤 한 번 더 조립해도 비용이 없다 — SKILL.md의 unverified 표시를
    // 실제 게이트 결과와 맞춘다(DESIGN §5.1).
    const finalAssembly = assemble(outcome.report.passed);
    if (!finalAssembly.ok) return finalAssembly;
    files = finalAssembly.value;
  } else {
    gate = { skipped: true };
    goldenQa = [];
    files = firstAssembly.value;
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
    gate,
    goldenQa,
  };

  return ok({ manifest, files, validation, slug: plan.slug, llmCalls: tracked.summary().calls });
}
