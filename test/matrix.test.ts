import { describe, expect, it } from "vitest";
import { buildMatrix } from "../src/matrix.js";

describe("compatibility matrix", () => {
  it("never marks a client tested without a result", () => {
    const rows = buildMatrix([], [], []);
    const manual = rows.filter((r) => ["Claude Desktop", "Cursor", "ChatGPT developer mode"].includes(r.client));
    expect(manual).toHaveLength(3);
    for (const r of manual) expect(r.coverage).toBe("not run");
    expect(rows.find((r) => r.transport === "Streamable HTTP")?.coverage).toBe("not run");
  });

  it("shows recorded manual results as manual coverage", () => {
    const rows = buildMatrix([], [], [{ client: "Cursor", clientVersion: "2.1", date: "2026-11-16", check: "M3", result: "fail", evidence: "manual/evidence/m3.png" }]);
    const cursor = rows.find((r) => r.client === "Cursor");
    expect(cursor).toMatchObject({ coverage: "manual", version: "2.1", result: "0/1 checks pass" });
  });
});
