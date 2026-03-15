// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createEmptyBindingDraft,
  envBindingToDraft,
  summarizeExternalWorkSyncResult,
  toEnvBinding,
} from "./external-work";

describe("external work ui helpers", () => {
  it("creates env bindings from plain and secret drafts", () => {
    expect(
      toEnvBinding({
        mode: "plain",
        plainValue: "  token-1  ",
        secretId: "",
      }),
    ).toEqual({
      type: "plain",
      value: "token-1",
    });

    expect(
      toEnvBinding({
        mode: "secret",
        plainValue: "",
        secretId: "secret-1",
      }),
    ).toEqual({
      type: "secret_ref",
      secretId: "secret-1",
      version: "latest",
    });
  });

  it("converts runtime env bindings back into ui drafts", () => {
    expect(envBindingToDraft("legacy-inline")).toEqual({
      mode: "plain",
      plainValue: "legacy-inline",
      secretId: "",
    });

    expect(
      envBindingToDraft({
        type: "secret_ref",
        secretId: "secret-9",
      }),
    ).toEqual({
      mode: "secret",
      plainValue: "",
      secretId: "secret-9",
    });
  });

  it("summarizes TAPD and Gitee sync results for toast usage", () => {
    expect(
      summarizeExternalWorkSyncResult({
        fetchedCount: 12,
        syncedCount: 10,
        mappedCount: 7,
        failedCount: 2,
      }),
    ).toBe("Fetched 12, synced 10, mapped 7, failed 2.");

    expect(
      summarizeExternalWorkSyncResult({
        createdCount: 1,
        updatedCount: 2,
        workspaces: [{ id: "workspace-1" }],
      }),
    ).toBe("Updated 2 workspace bindings and created 1 new workspaces.");
  });

  it("starts binding drafts in plain mode by default", () => {
    expect(createEmptyBindingDraft()).toEqual({
      mode: "plain",
      plainValue: "",
      secretId: "",
    });
  });
});
