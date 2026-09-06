import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../src/version.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// T0 더미 테스트: version.ts가 package.json과 어긋나지 않는지 확인하는 실질적인 회귀 방지 테스트.
describe("PACKAGE_VERSION", () => {
  it("matches package.json's version field", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
