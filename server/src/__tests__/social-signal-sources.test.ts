import { describe, expect, it, vi } from "vitest";
import { socialSignalSources } from "@paperclipai/db";
import { HttpError } from "../errors.js";

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, holder: { env: Record<string, unknown> }) => holder),
  resolveEnvBindings: vi.fn(async (_companyId: string, env: Record<string, unknown>) => ({
    env: Object.fromEntries(
      Object.entries(env).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "plain"
            ? String((value as { value?: unknown }).value ?? "")
            : "resolved-secret",
      ]),
    ),
    secretKeys: new Set<string>(),
  })),
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

import { socialSignalSourceService } from "../services/social-signal-sources.js";

function createSourceRow(overrides?: Record<string, unknown>) {
  return {
    id: "source-1",
    companyId: "company-1",
    provider: "x",
    kind: "x_query",
    name: "X pain radar",
    enabled: true,
    targetStage: "discover",
    config: {
      kind: "x_query",
      query: "founder pain",
      maxResults: 10,
      language: null,
      schedule: {
        enabled: false,
        intervalMinutes: 60,
      },
      automation: {
        scoringMode: "rules",
        llmModel: "gpt-5",
        reviewThreshold: 70,
        rejectThreshold: 35,
        autoPromote: false,
        promoteThreshold: 82,
        minimumScores: {
          pain: 65,
          urgency: 55,
          monetization: 55,
        },
      },
      credentials: {
        bearerToken: {
          type: "plain",
          value: "token-1",
        },
      },
    },
    lastCursor: null,
    lastSyncedAt: null,
    lastError: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeDb(insertedResults: boolean[], sourceOverrides?: Record<string, unknown>) {
  const sourceRow = createSourceRow(sourceOverrides);
  const errorUpdates: Array<Record<string, unknown>> = [];
  const activityEntries: Array<Record<string, unknown>> = [];
  const sourceRows = [sourceRow];

  function createSelectChain(table: unknown) {
    const rows = table === socialSignalSources ? sourceRows : [];
    const chain = {
      where() {
        return chain;
      },
      orderBy: async () => rows,
      then<TResult1 = typeof rows, TResult2 = never>(
        onfulfilled?:
          | ((value: typeof rows) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(rows).then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  return {
    select() {
      return {
        from(table: unknown) {
          return createSelectChain(table);
        },
      };
    },
    insert() {
      return {
        values(values: Record<string, unknown>) {
          activityEntries.push(values);
          return Promise.resolve([{ id: `activity-${activityEntries.length}` }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: () => {
              if (table === socialSignalSources) {
                errorUpdates.push(values);
              }
              return {
                returning: async () => [
                  {
                    ...sourceRow,
                    ...values,
                  },
                ],
              };
            },
          };
        },
      };
    },
    __errorUpdates: errorUpdates,
    __activityEntries: activityEntries,
    __insertedResults: insertedResults,
  };
}

describe("social signal source service", () => {
  it("counts inserted and duplicate ingested signals during sync", async () => {
    const db = createFakeDb([true, false]);
    let createIndex = 0;
    const service = socialSignalSourceService(db as never, {
      ingestion: {
        syncSource: vi.fn(async () => ({
          items: [
            {
              source: "x",
              externalId: "1",
              title: "First signal",
              url: "https://x.com/i/web/status/1",
              authorHandle: "founder1",
              summary: "First signal summary",
              targetStage: "discover",
              occurredAt: new Date("2026-03-13T00:00:00Z"),
            },
            {
              source: "x",
              externalId: "2",
              title: "Second signal",
              url: "https://x.com/i/web/status/2",
              authorHandle: "founder2",
              summary: "Second signal summary",
              targetStage: "discover",
              occurredAt: new Date("2026-03-13T00:05:00Z"),
            },
          ],
          fetchedCount: 2,
          cursor: "2",
        })),
      } as never,
      signalService: {
        create: vi.fn(async () => {
          const inserted = db.__insertedResults[createIndex] ?? false;
          createIndex += 1;
          if (!inserted) {
            throw new HttpError(409, "duplicate");
          }
          return { id: `signal-${createIndex}` };
        }),
        promote: vi.fn(async () => ({ id: "signal-1" })),
      },
    });

    const result = await service.sync("source-1");

    expect(result.fetchedCount).toBe(2);
    expect(result.insertedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.promotedCount).toBe(0);
    expect(result.source.lastCursor).toBe("2");
    expect(result.source.lastError).toBeNull();
  });

  it("stores the last sync error when provider sync fails", async () => {
    const db = createFakeDb([]);
    const service = socialSignalSourceService(db as never, {
      ingestion: {
        syncSource: vi.fn(async () => {
          throw new HttpError(500, "X API request failed");
        }),
      } as never,
    });

    await expect(service.sync("source-1")).rejects.toThrow("X API request failed");
    expect(db.__errorUpdates).toHaveLength(1);
    expect(String(db.__errorUpdates[0]?.lastError ?? "")).toContain("X API request failed");
  });

  it("tracks auto-promoted signals when automation thresholds are met", async () => {
    const db = createFakeDb([true], {
      config: {
        kind: "x_query",
        query: "founder pain",
        maxResults: 10,
        language: null,
        automation: {
          reviewThreshold: 60,
          rejectThreshold: 20,
          autoPromote: true,
          promoteThreshold: 60,
          minimumScores: {
            pain: 40,
            urgency: 40,
            monetization: 40,
          },
        },
        credentials: {
          bearerToken: {
            type: "plain",
            value: "token-1",
          },
        },
      },
    });
    const promote = vi.fn(async () => ({ id: "signal-1" }));
    const service = socialSignalSourceService(db as never, {
      ingestion: {
        syncSource: vi.fn(async () => ({
          items: [
            {
              source: "x",
              externalId: "1",
              title: "Founders pay for manual launch spreadsheet cleanup",
              url: "https://x.com/i/web/status/1",
              authorHandle: "founder1",
              summary: "Teams waste hours every day and already pay contractors for this workflow.",
              targetStage: "discover",
              occurredAt: new Date("2026-03-13T00:00:00Z"),
            },
          ],
          fetchedCount: 1,
          cursor: "1",
        })),
      } as never,
      signalService: {
        create: vi.fn(async () => ({ id: "signal-1" })),
        promote,
      },
    });

    const result = await service.sync("source-1");

    expect(result.insertedCount).toBe(1);
    expect(result.promotedCount).toBe(1);
    expect(promote).toHaveBeenCalledTimes(1);
  });

  it("syncs due scheduled sources during scheduler tick", async () => {
    const db = createFakeDb([true], {
      createdAt: new Date("2026-03-13T00:00:00Z"),
      lastSyncedAt: new Date("2026-03-13T00:00:00Z"),
      config: {
        kind: "x_query",
        query: "founder pain",
        maxResults: 10,
        language: null,
        schedule: {
          enabled: true,
          intervalMinutes: 60,
        },
        automation: {
          reviewThreshold: 70,
          rejectThreshold: 35,
          scoringMode: "rules",
          llmModel: "gpt-5",
          autoPromote: false,
          promoteThreshold: 82,
          minimumScores: {
            pain: 65,
            urgency: 55,
            monetization: 55,
          },
        },
        credentials: {
          bearerToken: {
            type: "plain",
            value: "token-1",
          },
        },
      },
    });
    const service = socialSignalSourceService(db as never, {
      ingestion: {
        syncSource: vi.fn(async () => ({
          items: [
            {
              source: "x",
              externalId: "1",
              title: "Manual analytics workflow",
              url: "https://x.com/i/web/status/1",
              authorHandle: "founder1",
              summary: "Teams pay contractors to update launch spreadsheets every day.",
              targetStage: "discover",
              occurredAt: new Date("2026-03-13T02:00:00Z"),
            },
          ],
          fetchedCount: 1,
          cursor: "1",
        })),
      } as never,
      signalService: {
        create: vi.fn(async () => ({ id: "signal-1" })),
        promote: vi.fn(async () => ({ id: "signal-1" })),
      },
    });

    const result = await service.tickScheduler(new Date("2026-03-13T02:10:00Z"));

    expect(result.checked).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.inserted).toBe(1);
  });
});
