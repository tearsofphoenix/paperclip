import { describe, expect, it } from "vitest";
import { shouldRepairLegacyZeroPersonDiscoverIssue } from "../services/company-blueprint-repairs.js";

describe("shouldRepairLegacyZeroPersonDiscoverIssue", () => {
  it("returns true for legacy discover issues that never actually ran", () => {
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "in_progress",
        checkoutRunId: null,
        executionRunId: null,
        heartbeatRunCount: 0,
        activityRunCount: 0,
      }),
    ).toBe(true);
  });

  it("returns false when run evidence exists", () => {
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "in_progress",
        checkoutRunId: null,
        executionRunId: null,
        heartbeatRunCount: 1,
        activityRunCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "in_progress",
        checkoutRunId: null,
        executionRunId: null,
        heartbeatRunCount: 0,
        activityRunCount: 1,
      }),
    ).toBe(false);
  });

  it("returns false when issue already has direct run references or a different status", () => {
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "todo",
        checkoutRunId: null,
        executionRunId: null,
        heartbeatRunCount: 0,
        activityRunCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "in_progress",
        checkoutRunId: "checkout-run-id",
        executionRunId: null,
        heartbeatRunCount: 0,
        activityRunCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRepairLegacyZeroPersonDiscoverIssue({
        status: "in_progress",
        checkoutRunId: null,
        executionRunId: "execution-run-id",
        heartbeatRunCount: 0,
        activityRunCount: 0,
      }),
    ).toBe(false);
  });
});
