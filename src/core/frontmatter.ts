// SKILL.md YAML 프런트매터 — 직렬화와 파싱 한 쌍(DESIGN §3.1 E2). 예전엔 assembler가 `description: ${title}`처럼
// 값을 그대로 이어 붙이고 validator는 `^name:` 키 존재만 봤다 — `Guide: Setup` 같은 제목은 YAML을 깨뜨리는데도
// 자체 검증을 통과해 배포됐다. 이제 진짜 YAML 라이브러리로 쓰고(값은 항상 큰따옴표 — YAML 1.1 파서가 yes/no/null을
// 불리언·null로 읽는 함정까지 차단) 진짜 YAML 파서로 읽어 타입·값·키를 검사한다. 순수 계산, IO 없음.
import { z } from "zod";
import { YAMLParseError, parse, stringify } from "yaml";
import { MULTI_LINE_PATTERN } from "./modelText.js";
import { err, ok, type Result } from "./result.js";
import { slugSchema } from "./schemas.js";

/** Agent Skills 표준의 description 상한. */
export const MAX_DESCRIPTION_CHARS = 1024;

/** Agent Skills 표준이 정의한 프런트매터 키 — 그 밖의 키는 오류가 아니라 경고(표준이 자랄 수 있다). */
export const FRONTMATTER_KNOWN_KEYS: readonly string[] = [
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
];

export interface SkillFrontmatter {
  /** 스킬 디렉터리 이름과 같은 slug(소문자·숫자·하이픈, 64자 이하). */
  name: string;
  description: string;
}

const frontmatterSchema = z.looseObject({
  name: slugSchema,
  description: z
    .string()
    .max(MAX_DESCRIPTION_CHARS)
    .regex(MULTI_LINE_PATTERN, "control characters other than newline/tab are not allowed")
    .refine((s) => s.trim() !== "", "must not be blank"),
});

/** `---` 블록 하나를 만든다. 값은 전부 큰따옴표(JSON 호환 이스케이프) — 어떤 제목이든 파싱하면 그대로 돌아온다. */
export function serializeFrontmatter(fields: SkillFrontmatter): string {
  const yaml = stringify(
    { name: fields.name, description: fields.description },
    { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 },
  );
  return `---\n${yaml}---`;
}

export type FrontmatterProblem =
  /** 파일이 `---` 블록으로 시작하지 않는다. */
  | { kind: "missing_block" }
  /** 블록은 있지만 YAML로 파싱되지 않는다(`description: Guide: Setup` 등). */
  | { kind: "syntax"; detail: string }
  /** YAML이긴 한데 키-값 맵이 아니다(문자열·목록·빈 블록). */
  | { kind: "not_a_map" }
  /** 필수 키가 없다. */
  | { kind: "missing_field"; fields: string[] }
  /** 키는 있지만 타입·값이 틀렸다(숫자 name, 빈 description, slug 아닌 name, 너무 긴 description…). */
  | { kind: "invalid_field"; field: string; detail: string };

export interface ParsedFrontmatter {
  fields: SkillFrontmatter;
  /** 표준에 없는 키 — 호출자가 경고로 보고한다. */
  unknownKeys: string[];
  /** 프런트매터 블록 뒤의 본문. */
  body: string;
}

// 여는 `---` 줄, 내용(없을 수도), 닫는 `---` 줄. 닫는 줄 뒤에는 개행이나 파일 끝.
const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/u;

const REQUIRED_KEYS = ["name", "description"] as const;

/** SKILL.md 전체 내용을 받아 프런트매터를 실제 YAML로 파싱하고 Agent Skills 표준의 필수 키·타입·값을 검사한다. */
export function parseFrontmatter(content: string): Result<ParsedFrontmatter, FrontmatterProblem> {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) return err({ kind: "missing_block" });
  const block = match[1] ?? "";
  const body = content.slice(match[0].length);

  let data: unknown;
  try {
    data = parse(block) as unknown;
  } catch (e) {
    const detail =
      e instanceof YAMLParseError ? (e.message.split("\n")[0] ?? e.message) : "unknown";
    return err({ kind: "syntax", detail });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return err({ kind: "not_a_map" });
  }
  const record = data as Record<string, unknown>;

  const missing = REQUIRED_KEYS.filter((k) => !(k in record));
  if (missing.length > 0) return err({ kind: "missing_field", fields: missing });

  const parsed = frontmatterSchema.safeParse(record);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.map(String).join(".") ?? "frontmatter";
    const detail = first?.message ?? "invalid";
    return err({ kind: "invalid_field", field, detail });
  }
  const unknownKeys = Object.keys(record).filter((k) => !FRONTMATTER_KNOWN_KEYS.includes(k));
  return ok({
    fields: { name: parsed.data.name, description: parsed.data.description },
    unknownKeys,
    body,
  });
}
