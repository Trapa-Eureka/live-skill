// SKILL.md YAML frontmatter: a serialize/parse pair (DESIGN §3.1 E2). The assembler used to
// concatenate values verbatim (`description: ${title}`) and the validator only looked for a
// `^name:` key, so a title like `Guide: Setup` broke the YAML yet passed our own validation and got
// deployed. Now we write with a real YAML library (values always double-quoted, which also closes
// the trap of YAML 1.1 parsers reading yes/no/null as booleans/null) and read with a real YAML
// parser that checks types, values and keys. Pure computation, no IO.
import { z } from "zod";
import { YAMLParseError, parse, stringify } from "yaml";
import { MULTI_LINE_PATTERN } from "./modelText.js";
import { err, ok, type Result } from "./result.js";
import { slugSchema } from "./schemas.js";

/** The Agent Skills standard's description limit. */
export const MAX_DESCRIPTION_CHARS = 1024;

/** Frontmatter keys defined by the Agent Skills standard. Any other key is a warning, not an
 * error (the standard may grow). */
export const FRONTMATTER_KNOWN_KEYS: readonly string[] = [
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
];

export interface SkillFrontmatter {
  /** Slug equal to the skill directory name (lowercase, digits, hyphens; at most 64 chars). */
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

/** Builds one `---` block. Every value is double-quoted (JSON-compatible escapes), so any title
 * parses back verbatim. */
export function serializeFrontmatter(fields: SkillFrontmatter): string {
  const yaml = stringify(
    { name: fields.name, description: fields.description },
    { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 },
  );
  return `---\n${yaml}---`;
}

export type FrontmatterProblem =
  /** The file does not start with a `---` block. */
  | { kind: "missing_block" }
  /** A block exists but does not parse as YAML (`description: Guide: Setup` and the like). */
  | { kind: "syntax"; detail: string }
  /** Valid YAML, but not a key-value map (a string, a list, an empty block). */
  | { kind: "not_a_map" }
  /** A required key is missing. */
  | { kind: "missing_field"; fields: string[] }
  /** The key exists but its type or value is wrong (numeric name, empty description, non-slug
   * name, over-long description, ...). */
  | { kind: "invalid_field"; field: string; detail: string };

export interface ParsedFrontmatter {
  fields: SkillFrontmatter;
  /** Keys not in the standard; the caller reports them as warnings. */
  unknownKeys: string[];
  /** The body after the frontmatter block. */
  body: string;
}

// Opening `---` line, content (possibly none), closing `---` line. After the closing line: a
// newline or end of file.
const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/u;

const REQUIRED_KEYS = ["name", "description"] as const;

/** Takes the full SKILL.md content, parses the frontmatter as real YAML and checks the required
 * keys, types and values of the Agent Skills standard. */
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
