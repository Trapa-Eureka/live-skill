#!/usr/bin/env node
// CLI entry point, no logic (CLAUDE.md convention: cli/ is assembly only). Command definitions live in
// program.ts, real IO in adapters/, and the real pipeline/gate decisions in core/. This file only loads
// .env and runs the program inside the error boundary (G1).
import { describeTopLevelError } from "./errorBoundary.js";
import { buildProgram } from "./program.js";

// Node 22.12+ can read .env directly; if it is missing or unsupported, skip silently (guardrail 7:
// .env is never committed).
try {
  process.loadEnvFile();
} catch {
  /* no .env, ignore */
}

// G1: an exception reaching this point is either a configuration error (exit 1) or a bug (exit 2);
// show one line and a fix instead of a stack trace.
try {
  await buildProgram().parseAsync(process.argv);
} catch (e) {
  const failure = describeTopLevelError(e);
  console.error(failure.message);
  process.exitCode = failure.exitCode;
}
