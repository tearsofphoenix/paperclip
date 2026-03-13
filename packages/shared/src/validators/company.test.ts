import { describe, expect, it } from "vitest";
import {
  AGENT_ROLES,
  companyMetadataSchema,
  zeroPersonRDBlueprintBootstrapSchema,
} from "../index.js";

describe("zero-person company contracts", () => {
  it("adds marketer to agent roles", () => {
    expect(AGENT_ROLES).toContain("marketer");
  });

  it("accepts zero-person company metadata", () => {
    const parsed = companyMetadataSchema.parse({
      operatingModel: "zero_person_rd",
      templateVersion: "2026-03-13",
      blueprint: {
        key: "zero_person_rd",
        initializedAt: "2026-03-13T10:00:00.000Z",
        initializedByUserId: "user-1",
        socialChannels: ["x", "reddit"],
      },
    });

    expect(parsed.operatingModel).toBe("zero_person_rd");
    expect(parsed.blueprint?.socialChannels).toEqual(["x", "reddit"]);
  });

  it("defaults social channels for the zero-person bootstrap request", () => {
    const parsed = zeroPersonRDBlueprintBootstrapSchema.parse({});
    expect(parsed.socialChannels).toEqual(["x", "reddit"]);
  });
});
