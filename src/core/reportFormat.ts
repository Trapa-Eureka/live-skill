// Turns gate/validation reports into human-readable text. Pure string formatting, no external IO.
// The `report`/`validate`/`compile`/`eval` CLIs call only these functions ("cli is assembly only",
// DESIGN §6).
import type { OutputIntegrity } from "./integrity.js";
import type { LlmErrorKind, LlmProviderError } from "./llmError.js";
import { sanitizeExternalText } from "./modelText.js";
import type { PipelineError } from "./pipeline.js";
import type { PopulationMatch } from "./sources.js";
import type { GateReport } from "./types.js";
import type { ValidationReport } from "./validator.js";

export function formatGateReport(report: GateReport): string {
  const lines: string[] = [
    `Gate: ${report.passed ? "PASSED" : "FAILED"} (passRate ${(report.passRate * 100).toFixed(1)}% / threshold ${(report.threshold * 100).toFixed(0)}%)`,
    "",
    "Per chapter:",
  ];
  for (const c of report.perChapter) {
    lines.push(`  - ${c.file}: ${String(c.correct)}/${String(c.asked)} correct`);
  }
  // B2: a section with no generated questions is unverified and cannot pass regardless of the pass
  // rate. A shortfall is informational only.
  const uncovered = report.coverage.filter((c) => c.generated === 0);
  if (uncovered.length > 0) {
    lines.push("", "Unverified sections (question generation failed; cannot pass):");
    for (const c of uncovered) lines.push(`  - ${c.sectionId}`);
  }
  const short = report.coverage.filter((c) => c.generated > 0 && c.generated < c.requested);
  if (short.length > 0) {
    lines.push("", "Question shortfall (generated/requested):");
    for (const c of short) {
      lines.push(`  - ${c.sectionId}: ${String(c.generated)}/${String(c.requested)}`);
    }
  }
  if (report.failures.length > 0) {
    lines.push("", "Failed questions:");
    for (const f of report.failures) lines.push(`  - ${f.qaId}: ${f.reason}`);
  }
  return lines.join("\n");
}

/** Output integrity failure in plain words (E3): which files differ, how, and how to fix it. Empty string when status is ok. */
export function formatOutputIntegrity(r: OutputIntegrity): string {
  if (r.status === "ok") return "";
  const lines: string[] =
    r.status === "stale"
      ? [
          "Output integrity: STALE. The files on disk differ from the ones the manifest verified; the gate verdict does not apply to the current files.",
        ]
      : [
          "Output integrity: TAMPERED. The skill directory contains files the manifest does not know about; the gate never verified them.",
        ];
  const section = (title: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    lines.push(`  ${title}:`);
    for (const item of items) lines.push(`    - ${item}`);
  };
  section("Modified files", r.modified);
  section("Missing files", r.missing);
  section("Files not in manifest", r.unexpected);
  lines.push(
    r.status === "stale"
      ? "Fix: recompile with `compile --force`, or restore the files to their state at compile time."
      : "Fix: remove those files from the skill directory, or recompile with `compile --force`.",
  );
  return lines.join("\n");
}

const MAX_LISTED_IDS = 5;

function listIds(ids: readonly string[]): string {
  const head = ids.slice(0, MAX_LISTED_IDS).join(", ");
  return ids.length > MAX_LISTED_IDS
    ? `${head} … and ${String(ids.length - MAX_LISTED_IDS)} more`
    : head;
}

/** The --source population does not match the manifest (F3): which ids exist on only one side, and how to fix it. */
export function formatSourceMismatch(m: PopulationMatch): string {
  const lines = [
    "The --source documents do not match this manifest; the chapter assignment cannot be applied, so re-grading stops.",
  ];
  if (m.missing.length > 0) {
    lines.push(
      `  ${String(m.missing.length)} section(s) in manifest but not in source: ${listIds(m.missing)}`,
    );
  }
  if (m.unknown.length > 0) {
    lines.push(
      `  ${String(m.unknown.length)} section(s) in source but not in manifest: ${listIds(m.unknown)}`,
    );
  }
  lines.push(
    "Fix: pass the same files that were compiled, in the same folder layout (multi-source skills prefix section ids with the common parent folder). If the source really changed, recompile with `compile --force`.",
  );
  return lines.join("\n");
}

/** Sections whose body changed are informational only: questions are regenerated from the current source. Empty string when none. */
export function formatChangedSections(m: PopulationMatch): string {
  if (m.changed.length === 0) return "";
  return `Note: ${String(m.changed.length)} section(s) changed since compile (${listIds(m.changed)}). Questions are regenerated from the current source.`;
}

export function formatSkippedGate(): string {
  return "Gate: SKIPPED (--no-gate). The output was deployed with an unverified marker.";
}

const LLM_ERROR_TEXT: Record<LlmErrorKind, { what: string; fix: string }> = {
  auth: {
    what: "authentication failed",
    fix: "check ANTHROPIC_API_KEY in .env (see .env.example).",
  },
  rate_limit: {
    what: "rate limit exceeded",
    fix: "retry the same command in a moment. Lower QA_PER_SECTION to make fewer calls.",
  },
  network: { what: "network error", fix: "check the network/proxy and run the command again." },
  server: {
    what: "provider server error",
    fix: "the provider is having an outage; run the command again later.",
  },
  bad_response: {
    what: "malformed response",
    fix: "run the command again. If it repeats, try another MODEL.",
  },
  refusal: {
    what: "model refusal",
    fix: "the model refused this content; review the source document (not retried).",
  },
  unknown: {
    what: "unknown error",
    fix: "run the command again. If it repeats, report an issue with the message below.",
  },
};

export interface LlmFailureInfo {
  kind: LlmErrorKind;
  retryable: boolean;
  /** Text that already went through sanitizeExternalText, or the raw text (sanitized again here). */
  detail: string;
}

/** LLM failure in plain words (G1): which stage, what happened, whether it is retryable, calls made so far, and the fix. Never includes keys or source text. */
export function formatLlmFailure(stage: string, info: LlmFailureInfo, calls: number): string {
  const text = LLM_ERROR_TEXT[info.kind];
  const detail = sanitizeExternalText(info.detail);
  const lines = [
    `LLM call failed during ${stage}: ${text.what} (${info.kind}, ${info.retryable ? "retryable" : "not retryable"}). ${String(calls)} LLM calls made so far; nothing was written.`,
    `Fix: ${text.fix}`,
  ];
  if (detail !== "" && detail !== info.kind) lines.push(`Provider message: ${detail}`);
  return lines.join("\n");
}

/** Directly from an LlmProviderError instance (when caught outside the pipeline, as in eval). */
export function formatLlmProviderError(stage: string, e: LlmProviderError, calls: number): string {
  return formatLlmFailure(
    stage,
    { kind: e.kind, retryable: e.retryable, detail: e.message },
    calls,
  );
}

const STAGE_LABEL: Record<string, string> = {
  outline: "outline",
  distill: "distillation",
  gate: "gate",
};

/** One-line pipeline failure plus, for a structural validation failure, the report of which file
 * failed and why (E1); for an LLM failure, the stage, kind, retryability, call count, and fix (G1).
 * Shared by compile and smoke. */
export function formatCompileFailure(error: PipelineError): string {
  if (error.kind === "llm_failed") {
    return `Compile failed. ${formatLlmFailure(STAGE_LABEL[error.stage] ?? error.stage, error.error, error.calls)}`;
  }
  const head = `Compile failed: ${error.message}`;
  if (error.kind !== "validation_failed") return head;
  return `${head}\n${formatValidationReport(error.report)}`;
}

export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [`Validation: ${report.passed ? "PASSED" : "FAILED"}`];
  if (report.issues.length === 0) {
    lines.push("No issues.");
    return lines.join("\n");
  }
  lines.push("");
  for (const issue of report.issues) {
    lines.push(
      `  [${issue.severity.toUpperCase()}] ${issue.file} (${issue.code}): ${issue.message}`,
    );
  }
  return lines.join("\n");
}
