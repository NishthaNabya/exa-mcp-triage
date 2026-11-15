// Checks tool input schemas the way strict clients will see them, and compares
// the pinned server's tools with the hosted server's.
import { createHash } from "node:crypto";
import { Ajv } from "ajv";

export interface SchemaFinding {
  tool: string;
  source: "local" | "hosted";
  ajvStrict: string[]; // empty means Ajv compiled it in strict mode
  openAiStrict: string[]; // rules from developers.openai.com/api/docs/guides/structured-outputs ("Supported schemas")
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export function checkSchemas(tools: { name: string; inputSchema: unknown }[], source: SchemaFinding["source"]): SchemaFinding[] {
  return tools.map((t) => ({ tool: t.name, source, ajvStrict: ajvStrict(t.inputSchema), openAiStrict: openAiStrict(t.inputSchema) }));
}

function ajvStrict(schema: unknown): string[] {
  // A fresh instance per schema so one tool's $id cannot clash with another's.
  const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: true });
  try {
    const { $schema: _, ...rest } = isObj(schema) ? schema : {};
    ajv.compile(rest);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

const UNSUPPORTED = ["allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else"];

/** OpenAI strict mode, rule by rule. A tool that fails here needs converting before a strict client can use it. */
function openAiStrict(schema: unknown): string[] {
  const problems = new Set<string>();
  if (!isObj(schema) || schema.type !== "object" || "anyOf" in schema) problems.add("root must be an object without anyOf");
  let properties = 0;

  const walk = (node: unknown, path: string, depth: number) => {
    if (!isObj(node)) return;
    if (depth > 10) problems.add(`${path}: more than 10 levels of nesting`);
    for (const k of UNSUPPORTED) if (k in node) problems.add(`${path}: unsupported keyword ${k}`);
    if (node.type === "object" || isObj(node.properties)) {
      const props = isObj(node.properties) ? Object.keys(node.properties) : [];
      properties += props.length;
      if (node.additionalProperties !== false) problems.add(`${path}: additionalProperties must be false`);
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      const optional = props.filter((p) => !required.has(p));
      if (optional.length) problems.add(`${path}: every field must be required (optional: ${optional.join(", ")})`);
      for (const p of props) walk((node.properties as Json)[p], `${path}.${p}`, depth + 1);
    }
    if (isObj(node.items)) walk(node.items, `${path}[]`, depth + 1);
    for (const k of ["anyOf", "oneOf"]) if (Array.isArray(node[k])) (node[k] as unknown[]).forEach((s, i) => walk(s, `${path}.${k}[${i}]`, depth + 1));
  };
  walk(schema, "$", 0);
  if (properties > 5000) problems.add("more than 5000 properties");
  return [...problems];
}

export interface Drift {
  localVersion?: string;
  hostedVersion?: string;
  onlyLocal: string[];
  onlyHosted: string[];
  changedSchemas: { tool: string; changes: string[] }[];
}

type Tool = { name: string; inputSchema: unknown };

/** Differences between the pinned server and what Exa runs in production. */
export function compareTools(local: { version?: string; tools: Tool[] }, hosted: { version?: string; tools: Tool[] }): Drift {
  const hash = (s: unknown) => createHash("sha256").update(JSON.stringify(s)).digest("hex");
  const l = new Map(local.tools.map((t) => [t.name, t.inputSchema]));
  const h = new Map(hosted.tools.map((t) => [t.name, t.inputSchema]));
  return {
    ...(local.version && { localVersion: local.version }),
    ...(hosted.version && { hostedVersion: hosted.version }),
    onlyLocal: [...l.keys()].filter((n) => !h.has(n)),
    onlyHosted: [...h.keys()].filter((n) => !l.has(n)),
    changedSchemas: [...l.keys()]
      .filter((n) => h.has(n) && hash(h.get(n)) !== hash(l.get(n)))
      .map((tool) => ({ tool, changes: describeChange(l.get(tool), h.get(tool)) })),
  };
}

/** Top-level argument changes, in words: added, removed, now required, no longer required. */
function describeChange(before: unknown, after: unknown): string[] {
  const props = (s: unknown) => (isObj(s) && isObj(s.properties) ? s.properties : {});
  const req = (s: unknown) => new Set(isObj(s) && Array.isArray(s.required) ? (s.required as string[]) : []);
  const [pb, pa, rb, ra] = [props(before), props(after), req(before), req(after)];
  const out: string[] = [];
  for (const k of Object.keys(pa)) if (!(k in pb)) out.push(`added ${k}${ra.has(k) ? " (required)" : ""}`);
  for (const k of Object.keys(pb)) if (!(k in pa)) out.push(`removed ${k}`);
  for (const k of Object.keys(pa)) {
    if (!(k in pb)) continue;
    if (ra.has(k) && !rb.has(k)) out.push(`${k} is now required`);
    if (!ra.has(k) && rb.has(k)) out.push(`${k} is no longer required`);
    if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) out.push(`${k} definition changed`);
  }
  return out.length ? out : ["other schema change (descriptions or metadata)"];
}
