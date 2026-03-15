import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildImportedIssueDescription,
  externalWorkService,
  mapTapdStatusToIssueStatus,
} from "../services/external-work.js";
import type { Db } from "@paperclipai/db";
import { externalWorkIntegrations, externalWorkItemEvents, externalWorkItems } from "@paperclipai/db";

type IntegrationRow = typeof externalWorkIntegrations.$inferSelect;
type ItemRow = typeof externalWorkItems.$inferSelect;

function createIntegrationRow(overrides?: Partial<IntegrationRow>): IntegrationRow {
  return {
    id: "integration-1",
    companyId: "company-1",
    provider: "tapd",
    name: "TAPD Sync",
    enabled: true,
    config: {
      kind: "tapd_openapi",
      apiBaseUrl: "https://api.tapd.cn",
      fallbackMode: "prefer_api",
      schedule: {
        enabled: false,
        intervalMinutes: 60,
      },
      workspaceIds: ["workspace-1"],
      projectBindings: [
        {
          workspaceId: "workspace-1",
          projectId: "tapd-project-1",
          iterationId: null,
          targetProjectId: "11111111-1111-4111-8111-111111111111",
          targetWorkspaceId: null,
          itemTypes: ["story", "task", "bug"],
          enabled: true,
        },
      ],
      browserAutomation: null,
      credentials: {
        authMode: "basic",
        apiUser: {
          type: "plain",
          value: "tapd-user",
        },
        apiPassword: {
          type: "plain",
          value: "tapd-password",
        },
      },
    },
    lastCursor: null,
    lastSyncedAt: null,
    lastWritebackAt: null,
    lastError: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T05:00:00Z"),
    updatedAt: new Date("2026-03-15T05:00:00Z"),
    ...overrides,
  };
}

function createFakeDb(integrationOverrides?: Partial<IntegrationRow>, initialItems?: ItemRow[]) {
  const integration = createIntegrationRow(integrationOverrides);
  const items: ItemRow[] = [...(initialItems ?? [])];
  const itemEvents: Array<Record<string, unknown>> = [];
  const activityEntries: Array<Record<string, unknown>> = [];

  function createSelectChain(table: unknown) {
    const rows =
      table === externalWorkIntegrations
        ? [integration]
        : table === externalWorkItems
          ? items
          : table === externalWorkItemEvents
            ? itemEvents
            : [];
    const chain = {
      where() {
        return chain;
      },
      orderBy() {
        return Promise.resolve(rows);
      },
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
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
          const values = Array.isArray(value) ? value : [value];
          if (table === externalWorkItems) {
            const created = values.map((entry, index) => {
              const row = {
                id: String(entry.id ?? `external-item-${items.length + index + 1}`),
                companyId: String(entry.companyId),
                integrationId: String(entry.integrationId),
                provider: String(entry.provider),
                externalType: String(entry.externalType),
                externalSpaceId: (entry.externalSpaceId as string | null) ?? null,
                externalProjectId: (entry.externalProjectId as string | null) ?? null,
                externalIterationId: (entry.externalIterationId as string | null) ?? null,
                externalParentId: (entry.externalParentId as string | null) ?? null,
                externalId: String(entry.externalId),
                externalKey: (entry.externalKey as string | null) ?? null,
                title: String(entry.title),
                url: (entry.url as string | null) ?? null,
                remoteStatus: (entry.remoteStatus as string | null) ?? null,
                syncStatus: String(entry.syncStatus),
                assigneeName: (entry.assigneeName as string | null) ?? null,
                linkedProjectId: (entry.linkedProjectId as string | null) ?? null,
                linkedIssueId: (entry.linkedIssueId as string | null) ?? null,
                metadata: (entry.metadata as Record<string, unknown>) ?? {},
                lastSyncedAt: (entry.lastSyncedAt as Date | null) ?? null,
                lastWritebackAt: (entry.lastWritebackAt as Date | null) ?? null,
                lastError: (entry.lastError as string | null) ?? null,
                createdAt: new Date("2026-03-15T05:10:00Z"),
                updatedAt: new Date("2026-03-15T05:10:00Z"),
              } satisfies ItemRow;
              items.push(row);
              return row;
            });
            return {
              returning: async () => created,
            };
          }
          if (table === externalWorkItemEvents) {
            itemEvents.push(...values);
            return Promise.resolve([{ id: `event-${itemEvents.length}` }]);
          }
          activityEntries.push(...values);
          return Promise.resolve([{ id: `activity-${activityEntries.length}` }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: () => {
              if (table === externalWorkItems) {
                const target = items[0];
                Object.assign(target, values);
                return {
                  returning: async () => [target],
                };
              }
              if (table === externalWorkIntegrations) {
                Object.assign(integration, values);
                return {
                  returning: async () => [integration],
                };
              }
              return {
                returning: async () => [],
              };
            },
          };
        },
      };
    },
    __integration: integration,
    __items: items,
    __itemEvents: itemEvents,
    __activityEntries: activityEntries,
  } as unknown as Db & {
    __integration: IntegrationRow;
    __items: ItemRow[];
    __itemEvents: Array<Record<string, unknown>>;
    __activityEntries: Array<Record<string, unknown>>;
  };
}

describe("external work service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps TAPD statuses into Paperclip issue statuses", () => {
    expect(mapTapdStatusToIssueStatus("已完成")).toBe("done");
    expect(mapTapdStatusToIssueStatus("测试中")).toBe("in_review");
    expect(mapTapdStatusToIssueStatus("阻塞")).toBe("blocked");
    expect(mapTapdStatusToIssueStatus("开发中", { hasAssignee: false })).toBe("todo");
    expect(mapTapdStatusToIssueStatus("开发中", { hasAssignee: true })).toBe("in_progress");
  });

  it("builds imported issue descriptions with TAPD context", () => {
    const description = buildImportedIssueDescription({
      provider: "tapd",
      externalType: "bug",
      externalId: "bug-1",
      externalKey: "bug-1",
      externalSpaceId: "workspace-1",
      externalProjectId: "project-1",
      externalIterationId: "iteration-1",
      externalParentId: null,
      title: "Fix checkout",
      url: "https://www.tapd.cn/bug/1",
      remoteStatus: "处理中",
      assigneeName: "qa-bot",
      targetProjectId: "11111111-1111-4111-8111-111111111111",
      metadata: {
        description: "真实的线上结账失败问题",
      },
    });

    expect(description).toContain("Imported from TAPD BUG: bug-1");
    expect(description).toContain("Workspace ID: workspace-1");
    expect(description).toContain("真实的线上结账失败问题");
  });

  it("syncs TAPD items into external work items and creates linked issues", async () => {
    const db = createFakeDb();
    const tapd = {
      normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
      listStories: vi.fn(async () => ({
        items: [
          {
            type: "story",
            id: "story-1",
            workspaceId: "workspace-1",
            projectId: "tapd-project-1",
            iterationId: "iteration-1",
            parentId: null,
            title: "Validate landing page thesis",
            description: "从社交信号验证 Landing Page 的付费假设",
            status: "open",
            owner: "pm-bot",
            creator: "pm-bot",
            priority: null,
            severity: null,
            url: "https://www.tapd.cn/story/1",
            createdAt: "2026-03-15",
            updatedAt: "2026-03-15",
            raw: {},
          },
        ],
      })),
      listTasks: vi.fn(async () => ({
        items: [
          {
            type: "task",
            id: "task-1",
            workspaceId: "workspace-1",
            projectId: "tapd-project-1",
            iterationId: "iteration-1",
            parentId: "story-1",
            title: "Build payment wall",
            description: "实现 Stripe 付费墙",
            status: "开发中",
            owner: "dev-bot",
            creator: "pm-bot",
            priority: "high",
            severity: null,
            url: "https://www.tapd.cn/task/1",
            createdAt: "2026-03-15",
            updatedAt: "2026-03-15",
            raw: {},
          },
        ],
      })),
      listBugs: vi.fn(async () => ({
        items: [],
      })),
      listIterations: vi.fn(async () => ({
        items: [],
      })),
      listWorkspaces: vi.fn(async () => ({
        items: [],
      })),
    };
    const createdIssues: Array<Record<string, unknown>> = [];
    const issues = {
      getById: vi.fn(async () => null),
      create: vi.fn(async (_companyId: string, payload: Record<string, unknown>) => {
        createdIssues.push(payload);
        return {
          id:
            createdIssues.length === 1
              ? "22222222-2222-4222-8222-222222222222"
              : "33333333-3333-4333-8333-333333333333",
        };
      }),
      update: vi.fn(async (id: string, payload: Record<string, unknown>) => ({
        id,
        ...payload,
      })),
    };
    const service = externalWorkService(db, {
      tapd: tapd as never,
      issues: issues as never,
    });

    const result = await service.sync("integration-1", {
      actorType: "user",
      actorId: "user-1",
      userId: "user-1",
    });

    expect(result.fetchedCount).toBe(2);
    expect(result.syncedCount).toBe(2);
    expect(result.mappedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(db.__items).toHaveLength(2);
    expect(createdIssues).toHaveLength(2);
    expect(createdIssues[0]?.projectId).toBe("11111111-1111-4111-8111-111111111111");
    expect(createdIssues[1]?.status).toBe("todo");
    expect(db.__itemEvents).toHaveLength(4);
    expect(db.__integration.lastError).toBeNull();
  });

  it("updates an existing linked issue instead of creating a new one", async () => {
    const existingItem = {
      id: "external-item-1",
      companyId: "company-1",
      integrationId: "integration-1",
      provider: "tapd",
      externalType: "task",
      externalSpaceId: "workspace-1",
      externalProjectId: "tapd-project-1",
      externalIterationId: "iteration-1",
      externalParentId: null,
      externalId: "task-1",
      externalKey: "task-1",
      title: "Old title",
      url: "https://www.tapd.cn/task/1",
      remoteStatus: "open",
      syncStatus: "mapped",
      assigneeName: "dev-bot",
      linkedProjectId: "11111111-1111-4111-8111-111111111111",
      linkedIssueId: "22222222-2222-4222-8222-222222222222",
      metadata: {},
      lastSyncedAt: null,
      lastWritebackAt: null,
      lastError: null,
      createdAt: new Date("2026-03-15T05:00:00Z"),
      updatedAt: new Date("2026-03-15T05:00:00Z"),
    } satisfies ItemRow;
    const db = createFakeDb(undefined, [existingItem]);
    const tapd = {
      normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
      listStories: vi.fn(async () => ({ items: [] })),
      listTasks: vi.fn(async () => ({
        items: [
          {
            type: "task",
            id: "task-1",
            workspaceId: "workspace-1",
            projectId: "tapd-project-1",
            iterationId: "iteration-1",
            parentId: null,
            title: "Updated title",
            description: "更新标题与状态",
            status: "已完成",
            owner: "dev-bot",
            creator: "pm-bot",
            priority: null,
            severity: null,
            url: "https://www.tapd.cn/task/1",
            createdAt: "2026-03-15",
            updatedAt: "2026-03-15",
            raw: {},
          },
        ],
      })),
      listBugs: vi.fn(async () => ({ items: [] })),
      listIterations: vi.fn(async () => ({ items: [] })),
      listWorkspaces: vi.fn(async () => ({ items: [] })),
    };
    const issues = {
      getById: vi.fn(async () => ({
        id: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: "agent-1",
        assigneeUserId: null,
      })),
      create: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
      })),
      update: vi.fn(async (id: string, payload: Record<string, unknown>) => ({
        id,
        ...payload,
      })),
    };
    const service = externalWorkService(db, {
      tapd: tapd as never,
      issues: issues as never,
    });

    const result = await service.sync("integration-1");

    expect(result.fetchedCount).toBe(1);
    expect(result.mappedCount).toBe(1);
    expect(issues.create).not.toHaveBeenCalled();
    expect(issues.update).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        title: "Updated title",
        status: "done",
      }),
    );
    expect(db.__items[0]?.title).toBe("Updated title");
  });

  it("marks items as failed when issue mapping throws", async () => {
    const db = createFakeDb();
    const tapd = {
      normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
      listStories: vi.fn(async () => ({ items: [] })),
      listTasks: vi.fn(async () => ({
        items: [
          {
            type: "task",
            id: "task-1",
            workspaceId: "workspace-1",
            projectId: "tapd-project-1",
            iterationId: null,
            parentId: null,
            title: "Broken task",
            description: "issue create fails",
            status: "open",
            owner: "dev-bot",
            creator: "pm-bot",
            priority: null,
            severity: null,
            url: null,
            createdAt: null,
            updatedAt: null,
            raw: {},
          },
        ],
      })),
      listBugs: vi.fn(async () => ({ items: [] })),
      listIterations: vi.fn(async () => ({ items: [] })),
      listWorkspaces: vi.fn(async () => ({ items: [] })),
    };
    const issues = {
      getById: vi.fn(async () => null),
      create: vi.fn(async () => {
        throw new Error("issue create failed");
      }),
      update: vi.fn(async () => ({
        id: "55555555-5555-4555-8555-555555555555",
      })),
    };
    const service = externalWorkService(db, {
      tapd: tapd as never,
      issues: issues as never,
    });

    const result = await service.sync("integration-1");

    expect(result.failedCount).toBe(1);
    expect(db.__items[0]?.syncStatus).toBe("failed");
    expect(db.__items[0]?.lastError).toContain("issue create failed");
    expect(db.__integration.lastError).toContain("1 external work items failed");
  });
});
