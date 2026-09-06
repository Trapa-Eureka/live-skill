// eval 명령 — 기존 스킬 재채점(DESIGN §6). --source 없으면 manifest.goldenQa 재사용(qaGen 생략),
// 있으면 원문을 재추출해 runGate로 새로 돌린다. 어느 경로든 manifest는 덮어쓰지 않는다(읽기 전용 진단).
// D2: 두 경로 다 MAX_LLM_CALLS를 사전 추정으로 거르고, 실행 중에도 trackCost 래퍼로 강제한다(compile과 동일).
import {
  LlmCallCapError,
  chaptersFromManifest,
  estimateEvalCalls,
  estimateGateCalls,
  evaluateGoldenQa,
  formatGateReport,
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

export interface EvalOptions {
  skillDir: string;
  source?: string[] | undefined;
}

export interface EvalDeps {
  out: (line: string) => void;
  readSkillDir: (dir: string) => Promise<SkillFile[]>;
  readManifest: (dir: string) => Promise<Manifest>;
  collectInputFiles: (paths: readonly string[]) => Promise<string[]>;
  readSourceFile: (path: string) => Promise<SourceFile>;
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
    sources = await Promise.all(absolutePaths.map((p) => deps.readSourceFile(p)));
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    deps.out(`--source 경로를 읽을 수 없습니다. 수정 방법: 경로를 확인하세요. (${detail})`);
    return 1;
  }
  const sections = [];
  for (const src of sources) {
    const mime = "application/octet-stream";
    const extractor = deps.extractors.find((e) => e.supports(mime, src.path));
    if (extractor === undefined) {
      deps.out(`"${src.path}": 지원하지 않는 형식입니다.`);
      return 1;
    }
    const extracted = await extractor.extract(src.bytes);
    if (!extracted.ok) {
      deps.out(`"${src.path}": 추출 실패(${extracted.error.kind}).`);
      return 1;
    }
    sections.push(...extracted.value.sections);
  }

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
