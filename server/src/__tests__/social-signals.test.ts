import { describe, expect, it } from "vitest";
import { buildSocialSignalSummary } from "../services/social-signals.js";

describe("buildSocialSignalSummary", () => {
  it("maps grouped status rows into dashboard counts", () => {
    expect(
      buildSocialSignalSummary([
        { status: "new", count: 3 },
        { status: "validated", count: 2 },
        { status: "promoted", count: 1 },
      ]),
    ).toEqual({
      new: 3,
      reviewing: 0,
      validated: 2,
      rejected: 0,
      promoted: 1,
    });
  });
});
