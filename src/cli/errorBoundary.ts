// Top-level CLI error boundary (G1, DESIGN §6). Failures handled by run<Command>() (input, validation,
// gate, LLM, caps) end there with a message and exit code 1. Only two kinds reach this point: a user
// configuration error (ConfigError, exit 1) and an unexpected internal error (a bug, exit 2, with a
// hint to file an issue). Either way a polished one-liner is shown instead of a stack trace.
import { ConfigError, sanitizeExternalText } from "../core/index.js";

export interface TopLevelFailure {
  message: string;
  exitCode: 1 | 2;
}

export function describeTopLevelError(e: unknown): TopLevelFailure {
  if (e instanceof ConfigError) {
    return { message: `Configuration error: ${sanitizeExternalText(e.message, 500)}`, exitCode: 1 };
  }
  const detail =
    e instanceof Error
      ? `${e.name}: ${sanitizeExternalText(e.message, 300)}`
      : sanitizeExternalText(String(e), 300);
  return {
    message: `Internal error (unexpected failure): ${detail}. Fix: run the same command again; if it repeats, please report an issue with this message.`,
    exitCode: 2,
  };
}
