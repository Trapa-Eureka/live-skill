// Package version read from package.json at runtime, so `--version` can never drift from the release.
// Works both from src/ (tsx) and dist/ (build): both are one directory below the package root's child.
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
export const PACKAGE_VERSION: string = pkg.version;
