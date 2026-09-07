import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../src/version.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// T0 placeholder test that still earns its keep: a regression check that version.ts never drifts from package.json.
describe("PACKAGE_VERSION", () => {
  it("matches package.json's version field", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
