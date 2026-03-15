import type { EnvBinding } from "@paperclipai/shared";

export type BindingDraft = {
  mode: "plain" | "secret";
  plainValue: string;
  secretId: string;
};

export type ExternalWorkSyncResultLike =
  | {
      fetchedCount: number;
      syncedCount: number;
      mappedCount: number;
      failedCount: number;
    }
  | {
      createdCount: number;
      updatedCount: number;
      workspaces: Array<{ id: string }>;
    };

export function prettyExternalWorkValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function createEmptyBindingDraft(): BindingDraft {
  return {
    mode: "plain",
    plainValue: "",
    secretId: "",
  };
}

export function envBindingToDraft(binding: EnvBinding | null | undefined): BindingDraft {
  if (!binding) return createEmptyBindingDraft();
  if (typeof binding === "string") {
    return {
      mode: "plain",
      plainValue: binding,
      secretId: "",
    };
  }
  if (binding.type === "secret_ref") {
    return {
      mode: "secret",
      plainValue: "",
      secretId: binding.secretId,
    };
  }
  return {
    mode: "plain",
    plainValue: binding.value,
    secretId: "",
  };
}

export function toEnvBinding(draft: BindingDraft): EnvBinding | null {
  if (draft.mode === "secret") {
    if (!draft.secretId.trim()) return null;
    return {
      type: "secret_ref",
      secretId: draft.secretId.trim(),
      version: "latest",
    };
  }
  if (!draft.plainValue.trim()) return null;
  return {
    type: "plain",
    value: draft.plainValue.trim(),
  };
}

export function summarizeExternalWorkSyncResult(result: ExternalWorkSyncResultLike) {
  if ("fetchedCount" in result) {
    return `Fetched ${result.fetchedCount}, synced ${result.syncedCount}, mapped ${result.mappedCount}, failed ${result.failedCount}.`;
  }
  return `Updated ${result.updatedCount} workspace bindings and created ${result.createdCount} new workspaces.`;
}
