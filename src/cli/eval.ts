// eval 명령 — 기존 스킬 재채점(DESIGN §6). --source 없으면 manifest.goldenQa 재사용(qaGen 생략),
// 있으면 원문을 재추출해 runGate로 새로 돌린다. 어느 경로든 manifest는 덮어쓰지 않는다(읽기 전용 진단).
import {
  chaptersFromManifest,
  evaluateGoldenQa,
  formatGateReport,
  missingChapterFiles,
  runGate,
  type Config,
  type DocumentExtractor,
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

  if (opts.source === undefined || opts.source.length === 0) {
    // 재사용 경로 — 원문 없이, qaGen도 없이 manifest의 QA를 그대로 다시 채점한다.
    const report = await evaluateGoldenQa(
      manifest.goldenQa,
      { files, chapters, qaPerSection: deps.config.qaPerSection },
      deps.llm,
      deps.config.gateThreshold,
    );
    deps.out(formatGateReport(report));
    return report.passed ? 0 : 1;
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

  const outcome = await runGate(
    { files, chapters, sections },
    { llm: deps.llm, k: deps.config.qaPerSection, threshold: deps.config.gateThreshold },
  );
  deps.out(formatGateReport(outcome.report));
  return outcome.report.passed ? 0 : 1;
}
