import { describe, expect, it } from "vitest";
import {
  ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE,
  buildZeroPersonRDFunnelSummary,
  ZERO_PERSON_RD_ISSUE_DEFINITIONS,
} from "../services/company-blueprints.js";

describe("ZERO_PERSON_RD_ISSUE_DEFINITIONS", () => {
  it("seeds discover work as todo before any agent run starts", () => {
    const discoverIssue = ZERO_PERSON_RD_ISSUE_DEFINITIONS.find(
      (definition) => definition.stage === "discover",
    );

    expect(discoverIssue).toMatchObject({
      stage: "discover",
      status: "todo",
      title: ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE,
    });
  });
});

describe("buildZeroPersonRDFunnelSummary", () => {
  it("counts active stage work and shipped launch items", () => {
    const summary = buildZeroPersonRDFunnelSummary([
      { labelName: "funnel:discover", status: "in_progress", count: 3 },
      { labelName: "funnel:validate", status: "todo", count: 2 },
      { labelName: "funnel:build", status: "backlog", count: 1 },
      { labelName: "funnel:launch", status: "done", count: 4 },
      { labelName: "funnel:growth", status: "cancelled", count: 9 },
    ]);

    expect(summary).toEqual({
      operatingModel: "zero_person_rd",
      discover: 3,
      validate: 2,
      build: 1,
      launch: 0,
      growth: 0,
      shipped: 4,
    });
  });
});
