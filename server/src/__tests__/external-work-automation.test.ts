import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  externalWorkIntegrations,
  externalWorkItemEvents,
  externalWorkItems,
  projectWorkspaces,
} from "@paperclipai/db";
import { externalWorkAutomationService } from "../services/external-work-automation.js";

type IntegrationRow = typeof externalWorkIntegrations.$inferSelect;
type ItemRow = typeof externalWorkItems.$inferSelect;
type WorkspaceRow = typeof projectWorkspaces.$inferSelect;

function createTapdIntegrationRow(overrides?: Partial<IntegrationRow>): IntegrationRow {
  return {
    id: "tapd-integration-1",
    companyId: "company-1",
    provider: "tapd",
    name: "TAPD Scheduler",
    enabled: true,
    config: {
      kind: "tapd_openapi",
      apiBaseUrl: "https://api.tapd.cn",
      fallbackMode: "prefer_api",
      schedule: {
        enabled: true,
        intervalMinutes: 60,
      },
      workspaceIds: ["workspace-1"],
      projectBindings: [],
      browserAutomation: null,
      credentials: {
        authMode: "basic",
        apiUser: { type: "plain", value: "tapd-user" },
        apiPassword: { type: "plain", value: "tapd-password" },
      },
    },
    lastCursor: null,
    lastSyncedAt: new Date("2026-03-15T08:00:00Z"),
    lastWritebackAt: null,
    lastError: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T07:00:00Z"),
    updatedAt: new Date("2026-03-15T08:00:00Z"),
    ...overrides,
  };
}

function createGiteeIntegrationRow(overrides?: Partial<IntegrationRow>): IntegrationRow {
  return {
    id: "gitee-integration-1",
    companyId: "company-1",
    provider: "gitee",
    name: "Gitee Delivery",
    enabled: true,
    config: {
      kind: "gitee_openapi",
      apiBaseUrl: "https://gitee.com/api/v5",
      fallbackMode: "prefer_api",
      cloneProtocol: "https",
      repoBindings: [
        {
          targetProjectId: "project-1",
          targetWorkspaceId: "workspace-1",
          repoUrl: "https://gitee.com/demo/repo.git",
          repoRef: "main",
          cloneProtocol: "https",
          enabled: true,
        },
      ],
      browserAutomation: null,
      credentials: {
        authMode: "access_token",
        accessToken: { type: "plain", value: "gitee-token" },
      },
    },
    lastCursor: null,
    lastSyncedAt: null,
    lastWritebackAt: null,
    lastError: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T07:00:00Z"),
    updatedAt: new Date("2026-03-15T08:00:00Z"),
    ...overrides,
  };
}

function createExternalWorkItemRow(overrides?: Partial<ItemRow>): ItemRow {
  return {
    id: "external-item-1",
    companyId: "company-1",
    integrationId: "tapd-integration-1",
    provider: "tapd",
    externalType: "task",
    externalSpaceId: "workspace-1",
    externalProjectId: "tapd-project-1",
    externalIterationId: null,
    externalParentId: null,
    externalId: "task-1",
    externalKey: "task-1",
    title: "Ship zero-person delivery flow",
    url: "https://tapd.example/tasks/1",
    remoteStatus: "待处理",
    syncStatus: "mapped",
    assigneeName: "dev-bot",
    linkedProjectId: "project-1",
    linkedIssueId: "issue-1",
    metadata: {
      binding: {
        targetProjectId: "project-1",
        targetWorkspaceId: "workspace-1",
      },
    },
    lastSyncedAt: new Date("2026-03-15T10:00:00Z"),
    lastWritebackAt: null,
    lastError: null,
    createdAt: new Date("2026-03-15T09:00:00Z"),
    updatedAt: new Date("2026-03-15T10:00:00Z"),
    ...overrides,
  };
}

function createWorkspaceRow(overrides?: Partial<WorkspaceRow>): WorkspaceRow {
  return {
    id: "workspace-1",
    companyId: "company-1",
    projectId: "project-1",
    name: "repo",
    cwd: "/tmp/paperclip/repo",
    repoUrl: "https://gitee.com/demo/repo.git",
    repoRef: "main",
    metadata: {
      externalRepoBinding: {
        provider: "gitee",
        integrationId: "gitee-integration-1",
      },
    },
    isPrimary: true,
    createdAt: new Date("2026-03-15T09:00:00Z"),
    updatedAt: new Date("2026-03-15T09:00:00Z"),
    ...overrides,
  };
}

function createFakeDb(input?: {
  integrations?: IntegrationRow[];
  items?: ItemRow[];
  workspaces?: WorkspaceRow[];
}) {
  const integrations = [...(input?.integrations ?? [])];
  const items = [...(input?.items ?? [])];
  const workspaces = [...(input?.workspaces ?? [])];
  const itemEvents: Array<Record<string, unknown>> = [];
  const activityEntries: Array<Record<string, unknown>> = [];

  function createSelectChain(table: unknown) {
    const rows =
      table === externalWorkIntegrations
        ? integrations
        : table === externalWorkItems
          ? items
          : table === projectWorkspaces
            ? workspaces
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
        values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          const entries = Array.isArray(values) ? values : [values];
          if (table === externalWorkItemEvents) {
            itemEvents.push(...entries);
          } else {
            activityEntries.push(...entries);
          }
          return Promise.resolve([{ id: `entry-${itemEvents.length + activityEntries.length}` }]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              if (table === externalWorkItems) {
                for (const item of items) Object.assign(item, values);
                return {
                  returning: async () => items,
                };
              }
              if (table === externalWorkIntegrations) {
                for (const integration of integrations) Object.assign(integration, values);
              }
              return {
                returning: async () => integrations,
              };
            },
          };
        },
      };
    },
    __integrations: integrations,
    __items: items,
    __workspaces: workspaces,
    __itemEvents: itemEvents,
    __activityEntries: activityEntries,
  } as unknown as Db & {
    __integrations: IntegrationRow[];
    __items: ItemRow[];
    __workspaces: WorkspaceRow[];
    __itemEvents: Array<Record<string, unknown>>;
    __activityEntries: Array<Record<string, unknown>>;
  };
}

describe("external work automation service", () => {
  it("syncs scheduled TAPD integrations and wakes mapped assigned issues", async () => {
    const db = createFakeDb({
      integrations: [createTapdIntegrationRow()],
      items: [
        createExternalWorkItemRow({
          lastSyncedAt: new Date("2026-03-15T11:59:59Z"),
        }),
      ],
    });
    const externalWork = {
      sync: vi.fn(async () => ({
        fetchedCount: 1,
        syncedCount: 1,
        mappedCount: 1,
        failedCount: 0,
      })),
      listItems: vi.fn(async () => db.__items),
      getIntegrationById: vi.fn(async () => db.__integrations[0] ?? null),
    };
    const issues = {
      getById: vi.fn(async () => ({
        id: "issue-1",
        projectId: "project-1",
        status: "backlog",
        assigneeAgentId: "agent-1",
        assigneeUserId: null,
      })),
      update: vi.fn(async () => ({
        id: "issue-1",
        projectId: "project-1",
        status: "todo",
        assigneeAgentId: "agent-1",
        assigneeUserId: null,
      })),
    };
    const heartbeatWakeup = vi.fn(async () => null);
    const service = externalWorkAutomationService(db, {
      externalWork: externalWork as never,
      tapd: {
        normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
        updateBug: vi.fn(),
        updateTask: vi.fn(),
      } as never,
      issues: issues as never,
      heartbeatWakeup,
      logActivityFn: vi.fn(async () => undefined),
    });

    const result = await service.tickScheduler(new Date("2026-03-15T12:00:00Z"));

    expect(result.checked).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.woken).toBe(1);
    expect(externalWork.sync).toHaveBeenCalledWith(
      "tapd-integration-1",
      expect.objectContaining({
        actorId: "external_work_scheduler",
        invocation: "scheduler",
      }),
    );
    expect(issues.update).toHaveBeenCalledWith("issue-1", { status: "todo" });
    expect(heartbeatWakeup).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        source: "automation",
        reason: "external_work_execution_kickoff",
      }),
    );
    expect(db.__itemEvents.some((event) => event.eventType === "external_work_item.execution_kicked_off")).toBe(true);
  });

  it("commits from the execution worktree and writes TAPD task updates back", async () => {
    const db = createFakeDb({
      integrations: [
        createTapdIntegrationRow(),
        createGiteeIntegrationRow(),
      ],
      items: [createExternalWorkItemRow()],
      workspaces: [createWorkspaceRow()],
    });
    const commitAndPushWorkspace = vi.fn(async () => ({
      workspace: {
        id: "workspace-1",
        companyId: "company-1",
        projectId: "project-1",
        name: "repo",
        cwd: "/tmp/paperclip/repo",
        repoUrl: "https://gitee.com/demo/repo.git",
        repoRef: "main",
        metadata: null,
        isPrimary: true,
        createdAt: new Date("2026-03-15T09:00:00Z"),
        updatedAt: new Date("2026-03-15T09:00:00Z"),
      },
      cwd: "/tmp/paperclip/repo/.paperclip/worktrees/pc-1",
      branch: "paperclip/pc-1",
      head: "abc123",
      cloned: false,
      pulled: false,
      committed: true,
      pushed: true,
      commitSha: "abc123",
    }));
    const tapd = {
      normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
      updateTask: vi.fn(async () => ({ ok: true })),
      updateBug: vi.fn(async () => ({ ok: true })),
    };
    const service = externalWorkAutomationService(db, {
      externalWork: {
        sync: vi.fn(),
        listItems: vi.fn(),
        getIntegrationById: vi.fn(async (integrationId: string) =>
          db.__integrations.find((integration) => integration.id === integrationId) ?? null),
      } as never,
      gitee: {
        normalizeConfigForPersistence: vi.fn(),
        syncBindings: vi.fn(),
        ensureWorkspaceRepo: vi.fn(),
        commitAndPushWorkspace,
      } as never,
      tapd: tapd as never,
      issues: {
        getById: vi.fn(async () => ({
          id: "issue-1",
          identifier: "PC-1",
          title: "Ship zero-person delivery flow",
          projectId: "project-1",
          status: "done",
          assigneeAgentId: "agent-1",
          assigneeUserId: null,
        })),
        update: vi.fn(),
      } as never,
      logActivityFn: vi.fn(async () => undefined),
    });

    const result = await service.finalizeRun({
      companyId: "company-1",
      issueId: "issue-1",
      projectId: "project-1",
      runId: "run-1",
      agentId: "agent-1",
      invocationSource: "automation",
      outcome: "succeeded",
      contextSnapshot: {
        paperclipWorkspace: {
          workspaceId: "workspace-1",
          cwd: "/tmp/paperclip/repo",
          worktreePath: "/tmp/paperclip/repo/.paperclip/worktrees/pc-1",
          branchName: "paperclip/pc-1",
        },
      },
      resultJson: {
        paperclipGit: {
          enabled: true,
          message: "feat(PC-1): ship delivery flow",
        },
        paperclipTapd: {
          enabled: true,
          status: "已完成",
          fields: {
            owner: "dev-bot",
          },
        },
      },
    });

    expect(result.writebackCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(commitAndPushWorkspace).toHaveBeenCalledWith(
      "gitee-integration-1",
      expect.objectContaining({
        workspaceId: "workspace-1",
        cwd: "/tmp/paperclip/repo/.paperclip/worktrees/pc-1",
        branch: "paperclip/pc-1",
      }),
      expect.any(Object),
    );
    expect(tapd.updateTask).toHaveBeenCalledWith(
      "company-1",
      expect.any(Object),
      "task-1",
      expect.objectContaining({
        status: "已完成",
        owner: "dev-bot",
      }),
    );
    expect(db.__items[0]?.remoteStatus).toBe("已完成");
    expect(db.__itemEvents.some((event) => event.eventType === "external_work_item.repo_pushed")).toBe(true);
    expect(
      db.__itemEvents.some((event) => event.eventType === "external_work_item.tapd_writeback_succeeded"),
    ).toBe(true);
  });

  it("keeps commit success when TAPD writeback fails and records the partial failure", async () => {
    const db = createFakeDb({
      integrations: [
        createTapdIntegrationRow(),
        createGiteeIntegrationRow(),
      ],
      items: [createExternalWorkItemRow()],
      workspaces: [createWorkspaceRow()],
    });
    const service = externalWorkAutomationService(db, {
      externalWork: {
        sync: vi.fn(),
        listItems: vi.fn(),
        getIntegrationById: vi.fn(async (integrationId: string) =>
          db.__integrations.find((integration) => integration.id === integrationId) ?? null),
      } as never,
      gitee: {
        normalizeConfigForPersistence: vi.fn(),
        syncBindings: vi.fn(),
        ensureWorkspaceRepo: vi.fn(),
        commitAndPushWorkspace: vi.fn(async () => ({
          workspace: {
            id: "workspace-1",
            companyId: "company-1",
            projectId: "project-1",
            name: "repo",
            cwd: "/tmp/paperclip/repo",
            repoUrl: "https://gitee.com/demo/repo.git",
            repoRef: "main",
            metadata: null,
            isPrimary: true,
            createdAt: new Date("2026-03-15T09:00:00Z"),
            updatedAt: new Date("2026-03-15T09:00:00Z"),
          },
          cwd: "/tmp/paperclip/repo/.paperclip/worktrees/pc-1",
          branch: "paperclip/pc-1",
          head: "abc123",
          cloned: false,
          pulled: false,
          committed: true,
          pushed: true,
          commitSha: "abc123",
        })),
      } as never,
      tapd: {
        normalizeConfigForPersistence: vi.fn(async (_companyId: string, rawConfig: unknown) => rawConfig),
        updateTask: vi.fn(async () => {
          throw new Error("TAPD rejected update");
        }),
        updateBug: vi.fn(),
      } as never,
      issues: {
        getById: vi.fn(async () => ({
          id: "issue-1",
          identifier: "PC-1",
          title: "Ship zero-person delivery flow",
          projectId: "project-1",
          status: "done",
          assigneeAgentId: "agent-1",
          assigneeUserId: null,
        })),
        update: vi.fn(),
      } as never,
      logActivityFn: vi.fn(async () => undefined),
    });

    const result = await service.finalizeRun({
      companyId: "company-1",
      issueId: "issue-1",
      projectId: "project-1",
      runId: "run-1",
      agentId: "agent-1",
      invocationSource: "automation",
      outcome: "succeeded",
      contextSnapshot: {
        paperclipWorkspace: {
          workspaceId: "workspace-1",
          cwd: "/tmp/paperclip/repo",
          worktreePath: "/tmp/paperclip/repo/.paperclip/worktrees/pc-1",
          branchName: "paperclip/pc-1",
        },
      },
      resultJson: {
        paperclipGit: {
          enabled: true,
        },
        paperclipTapd: {
          enabled: true,
        },
      },
    });

    expect(result.commitResult?.pushed).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(result.warnings).toContain("TAPD rejected update");
    expect(db.__items[0]?.lastError).toBe("TAPD rejected update");
    expect(
      db.__itemEvents.some((event) => event.eventType === "external_work_item.tapd_writeback_failed"),
    ).toBe(true);
  });
});
