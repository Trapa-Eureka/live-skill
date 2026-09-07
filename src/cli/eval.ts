// eval 명령 — 기존 스킬 재채점(DESIGN §6). --source 없으면 manifest.goldenQa 재사용(qaGen 생략),
// 있으면 원문을 재추출해 runGate로 새로 돌린다. 어느 경로든 manifest는 덮어쓰지 않는다(읽기 전용 진단).
// D2: 두 경로 다 MAX_LLM_CALLS를 사전 추정으로 거르고, 실행 중에도 trackCost 래퍼로 강제한다(compile과 동일).
import {
  LlmCallCapError,
  buildPopulation,
  chaptersFromManifest,
  checkOutputs,
  estimateEvalCalls,
  estimateGateCalls,
  evaluateGoldenQa,
  extractSources,
  formatChangedSections,
  formatGateReport,
  formatOutputIntegrity,
  formatSourceMismatch,
  matchManifestSections,
  missingChapterFiles,
  runGate,
  trackCost,
  type Config,
  type DocumentExtractor,
  type GateReport,
  type LlmProvider,
  type Manifest,
} from "../core/index.js";
import type { SourceFile } from "../core/pipeline.js";
import type { SkillFile } from "../core/validator.js";
import { describeInputFailure } from "./inputFailure.js";

export interface EvalOptions {
  skillDir: string;
  source?: string[] | undefined;
}

export interface EvalDeps {
  out: (line: string) => void;
  readSkillDir: (dir: string) => Promise<SkillFile[]>;
  readManifest: (dir: string) => Promise<Manifest>;
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  readSourceFiles: (paths: readonly string[]) => Promise<SourceFile[]>;
  extractors: readonly DocumentExtractor[];
  llm: LlmProvider;
  config: Config;
}

export async function runEval(opts: EvalOptions, deps: EvalDeps): Promise<number> {
  let manifest: Manifest;
  let files: SkillFile[];
  try {
    manifest = await deps.readManifest(opts.skillDir);
    files = await deps.readSkillDir(opts.skillDir);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(
      `"${opts.skillDir}"를 읽을 수 없습니다. 수정 방법: 먼저 compile을 실행했는지, 경로가 맞는지 확인하세요. (${detail})`,
    );
    return 1;
  }
  // E3: manifest의 QA·챕터 배정은 그 manifest가 해시한 파일에 대한 것이다 — 파일이 달라졌으면 재채점도 무의미하다.
  const integrity = checkOutputs(manifest, files);
  if (integrity.status !== "ok") {
    deps.out(formatOutputIntegrity(integrity));
    deps.out("재채점 중단: 현재 파일이 manifest와 다릅니다 — LLM은 부르지 않았습니다.");
    return 1;
  }
  const chapters = chaptersFromManifest(manifest);

  // B3: manifest가 가리키는 챕터가 실제로 이 디렉터리에 있는지 — LLM을 부르기 전에 결정론으로 확인한다.
  const missing = missingChapterFiles(chapters, files);
  if (missing.length > 0) {
    deps.out(
      `manifest.json이 가리키는 챕터 파일이 "${opts.skillDir}"에 없습니다: ${missing.join(", ")}. 수정 방법: 이 디렉터리의 manifest가 맞는지 확인하거나 compile을 다시 실행하세요.`,
    );
    return 1;
  }

  const limit = deps.config.maxLlmCalls;
  const preflight = (estimated: number, what: string): boolean => {
    if (estimated <= limit) return true;
    deps.out(
      `재채점에 최대 ~${String(estimated)}회의 LLM 호출이 필요합니다(${what}) — MAX_LLM_CALLS 상한 ${String(limit)}을 넘습니다. 수정 방법: MAX_LLM_CALLS를 올리거나, 스킬을 더 작은 단위로 나눠 컴파일하세요.`,
    );
    return false;
  };
  const tracked = trackCost(deps.llm, { maxCalls: limit });
  const finish = (report: GateReport): number => {
    deps.out(formatGateReport(report));
    deps.out(`LLM 호출 ${String(tracked.summary().calls)}회`);
    return report.passed ? 0 : 1;
  };
  const capHit = (e: unknown): number | undefined => {
    if (!(e instanceof LlmCallCapError)) return undefined;
    deps.out(
      `재채점 중단: LLM 호출 ${String(e.calls)}회 후 다음 호출이 MAX_LLM_CALLS 상한 ${String(e.limit)}을 넘습니다. 수정 방법: MAX_LLM_CALLS를 올리거나 스킬을 나누세요.`,
    );
    return 1;
  };

  if (opts.source === undefined || opts.source.length === 0) {
    // 재사용 경로 — 원문 없이, qaGen도 없이 manifest의 QA를 그대로 다시 채점한다.
    if (
      !preflight(
        estimateEvalCalls(manifest.goldenQa.length),
        `문항 ${String(manifest.goldenQa.length)}개 × 3`,
      )
    ) {
      return 1;
    }
    try {
      const report = await evaluateGoldenQa(
        manifest.goldenQa,
        { files, chapters, qaPerSection: deps.config.qaPerSection },
        tracked.llm,
        deps.config.gateThreshold,
      );
      return finish(report);
    } catch (e) {
      const code = capHit(e);
      if (code !== undefined) return code;
      throw e;
    }
  }

  // --source 경로 — 원문을 재추출해 qaGen부터 새로 돌린다.
  let sources: SourceFile[];
  try {
    const absolutePaths = await deps.collectInputFiles(opts.source);
    sources = await deps.readSourceFiles(absolutePaths);
  } catch (e) {
    deps.out(`--source: ${describeInputFailure(e)}`);
    return 1;
  }
  // F3: compile과 같은 코드로 추출·접두어·모집단을 만든다 — 다중 소스 스킬의 manifest 배정(`a-readme/overview`)과 맞아야
  // qaGen 대상이 생긴다. 집합이 다르면 명시적으로 실패한다(질문 0개로 조용히 실패하던 것을 대신한다).
  const extracted = await extractSources(sources, deps.extractors);
  if (!extracted.ok) {
    deps.out(`--source: ${extracted.error.message}`);
    return 1;
  }
  const sections = buildPopulation(extracted.value);
  const match = matchManifestSections(manifest, sections);
  if (match.missing.length > 0 || match.unknown.length > 0) {
    deps.out(formatSourceMismatch(match));
    return 1;
  }
  const changed = formatChangedSections(match);
  if (changed !== "") deps.out(changed);

  const k = deps.config.qaPerSection;
  if (
    !preflight(
      estimateGateCalls(sections.length, k),
      `섹션 ${String(sections.length)}개, k=${String(k)}`,
    )
  ) {
    return 1;
  }
  try {
    const outcome = await runGate(
      { files, chapters, sections },
      { llm: tracked.llm, k, threshold: deps.config.gateThreshold },
    );
    return finish(outcome.report);
  } catch (e) {
    const code = capHit(e);
    if (code !== undefined) return code;
    throw e;
  }
}
