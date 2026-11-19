import { describe, expect, it } from "vitest";
import { requiredFlags, selectScenarios } from "../src/lab.js";
import { scenarios } from "../src/scenarios.js";

const ids = (o: Parameters<typeof selectScenarios>[1]) => selectScenarios(scenarios, o).map((s) => s.id);

describe("scenario selection", () => {
  it("keeps hosted and slow scenarios opt-in, even with --only", () => {
    expect(ids({ live: false, slow: false, only: ["hosted-keyless-search"] })).toEqual([]);
    expect(ids({ live: false, slow: false, only: ["server-reports-own-timeout"] })).toEqual([]);
    expect(ids({ live: true, slow: false, only: ["hosted-keyless-search"] })).toEqual(["hosted-keyless-search"]);
  });

  it("names the flags a scenario needs", () => {
    const byId = (id: string) => scenarios.find((s) => s.id === id)!;
    expect(requiredFlags(byId("hosted-keyless-search"))).toEqual(["--live"]);
    expect(requiredFlags(byId("server-reports-own-timeout"))).toEqual(["--slow"]);
    expect(requiredFlags(byId("request-id-dropped"))).toEqual([]);
  });

  it("runs only local, fast scenarios by default", () => {
    for (const s of selectScenarios(scenarios, { live: false, slow: false })) {
      expect(s.target).toBe("local");
      expect(s.slow).toBeFalsy();
    }
  });
});
