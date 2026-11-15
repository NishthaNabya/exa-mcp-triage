import { describe, expect, it } from "vitest";
import { checkSchemas } from "../src/schemas.js";
import { score } from "../src/evaluate.js";
import { redactDeep, redactHeaders, redactText } from "../src/redact.js";
import { verdictFor } from "../src/run.js";

const pass = { name: "c", pass: true, detail: "" };
const fail = { name: "c", pass: false, detail: "" };

describe("verdicts follow the label", () => {
  it.each([
    ["reproduced-defect", [fail], "reproduced"],
    ["reproduced-defect", [pass], "not-reproduced"],
    ["regression", [pass], "pass"],
    ["regression", [pass, fail], "regressed"],
    ["simulated", [fail], "unexpected"],
    ["external-not-reproduced", [pass], "not-reproduced"],
  ] as const)("%s with %j -> %s", (label, checks, verdict) => {
    expect(verdictFor(label, [...checks])).toBe(verdict);
  });
});

describe("score", () => {
  it("counts false positives and false negatives against 'none'", () => {
    const s = score([
      { id: "a", set: "generated", mode: "agent-view", expected: "none", predicted: "edge", rule: "" },
      { id: "b", set: "generated", mode: "agent-view", expected: "auth", predicted: "none", rule: "" },
      { id: "c", set: "generated", mode: "agent-view", expected: "auth", predicted: "auth", rule: "" },
    ]);
    expect(s).toMatchObject({ n: 3, correct: 1, falsePositives: 1, falseNegatives: 1 });
  });

  it("counts unknown as an abstention, not a wrong layer", () => {
    const s = score([
      { id: "a", set: "variant-4", mode: "agent-view", expected: "edge", predicted: "unknown", rule: "" },
      { id: "b", set: "variant-4", mode: "agent-view", expected: "edge", predicted: "client", rule: "" },
    ]);
    expect(s).toMatchObject({ correct: 0, abstained: 1, wrong: 1, falsePositives: 0 });
  });
});

describe("schema checks", () => {
  it("Ajv strict rejects an invalid regex escape, the class of bug in #447", () => {
    const [finding] = checkSchemas([{ name: "t", inputSchema: { type: "object", properties: { id: { type: "string", pattern: "^run\\_[a-z]+$" } } } }], "local");
    expect(finding?.ajvStrict.length).toBeGreaterThan(0);
  });

  it("OpenAI strict rules flag optional fields and a missing additionalProperties", () => {
    const [finding] = checkSchemas([{ name: "t", inputSchema: { type: "object", properties: { q: { type: "string" }, n: { type: "number" } }, required: ["q"] } }], "local");
    expect(finding?.openAiStrict.join(" ")).toContain("optional: n");
    expect(finding?.openAiStrict.join(" ")).toContain("additionalProperties");
  });

  it("passes a schema that meets OpenAI strict rules", () => {
    const [finding] = checkSchemas([{ name: "t", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } }], "local");
    expect(finding?.openAiStrict).toEqual([]);
    expect(finding?.ajvStrict).toEqual([]);
  });
});

describe("redaction", () => {
  it("removes keys from headers, URLs and bearer tokens", () => {
    expect(redactHeaders({ "x-api-key": "abc", Authorization: "Bearer xyz" })).toEqual({ "x-api-key": "[redacted]", Authorization: "[redacted]" });
    expect(redactText("https://mcp.exa.ai/mcp?exaApiKey=sk-12345678")).toBe("https://mcp.exa.ai/mcp?exaApiKey=[redacted]");
    expect(redactText("Authorization: Bearer abcdefgh12345")).toBe("Authorization: Bearer [redacted]");
  });

  it("removes the live EXA_API_KEY wherever it appears", () => {
    const before = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = "live-secret-key-999";
    try {
      expect(JSON.stringify(redactDeep({ note: "key live-secret-key-999 here", nested: ["live-secret-key-999"] }))).not.toContain("live-secret-key-999");
    } finally {
      if (before === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = before;
    }
  });
});
