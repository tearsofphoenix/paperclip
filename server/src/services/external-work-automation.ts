import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  externalWorkIntegrations,
  externalWorkItemEvents,
  externalWorkItems,
  projectWorkspaces,
} from "@paperclipai/db";
import type {
  ExternalWorkItem,
  GiteeRepoBinding,
  IssueStatus,
  ProjectWorkspace,
} from "@paperclipai/shared";
import { logActivity } from "./activity-log.js";
import {
  externalWorkService,
  mapTapdStatusToIssueStatus,
} from "./external-work.js";
import {
  giteeIntegrationService,
  type GiteeWorkspaceCommitPushResult,
  type GiteeWorkspacePullResult,
} from "./gitee-integration.js";
import { issueService } from "./issues.js";
import { tapdIntegrationService } from "./tapd-integration.js";

type ExternalWorkIntegrationRow = typeof externalWorkIntegrations.$inferSelect;
type ExternalWorkItemRow = typeof externalWorkItems.$inferSelect;
type ProjectWorkspaceRow = typeof projectWorkspaces.$inferSelect;

type AutomationActor = {
  actorType?: "user" | "agent" | "system";
  actorId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
  invocation?: "manual" | "scheduler";
};

type HeartbeatWakeupInput = {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  contextSnapshot?: Record<string, unknown>;
};

type HeartbeatWakeupFn = (
  agentId: string,
  input: HeartbeatWakeupInput,
) => Promise<unknown>;

type ExternalWorkSchedulerResult = {
  checked: number;
  synced: number;
  woken: number;
  failed: number;
};

type ExternalWorkPrepareRunInput = {
  companyId: string;
  issueId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  invocationSource?: string | null;
};

type ExternalWorkPrepareRunResult = {
  warnings: string[];
  repoPrepared: GiteeWorkspacePullResult | null;
};

type ExternalWorkFinalizeRunInput = {
  companyId: string;
  issueId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  invocationSource?: string | null;
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  contextSnapshot?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
};

type ExternalWorkFinalizeRunResult = {
  warnings: string[];
  commitResult: GiteeWorkspaceCommitPushResult | null;
  writebackCount: number;
  failedCount: number;
  skippedCount: number;
};

type GitAutomationDirective = {
  enabled: boolean | null;
  message: string | null;
  authorName: string | null;
  authorEmail: string | null;
  paths: string[] | null;
  push: boolean | null;
  cwd: string | null;
  branch: string | null;
};

type TapdAutomationDirective = {
  enabled: boolean | null;
  status: string | null;
  fields: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);
  return values.length > 0 ? values : null;
}

function resolveAutomationInvocation(source: string | null | undefined) {
  return source === "timer" ? "scheduler" : "manual";
}

function extractTargetWorkspaceId(item: ExternalWorkItemRow | null | undefined) {
  return readNonEmptyString(asRecord(item?.metadata)?.binding && asRecord(item?.metadata)?.binding
    ? asRecord(asRecord(item?.metadata)?.binding)?.targetWorkspaceId
    : null);
}

function extractWorkspaceBindingIntegrationId(
  workspace: { metadata?: Record<string, unknown> | null } | null | undefined,
) {
  return readNonEmptyString(
    asRecord(asRecord(workspace?.metadata)?.externalRepoBinding)?.integrationId,
  );
}

function deriveDefaultCommitMessage(issue: {
  identifier?: string | null;
  title?: string | null;
}) {
  const subject = readNonEmptyString(issue.title) ?? "delivery update";
  const identifier = readNonEmptyString(issue.identifier);
  return identifier ? `feat(${identifier}): ${subject}` : `feat: ${subject}`;
}

export function mapIssueStatusToTapdStatus(status: IssueStatus): string {
  switch (status) {
    case "backlog":
    case "todo":
      return "待处理";
    case "in_progress":
      return "进行中";
    case "in_review":
      return "测试中";
    case "blocked":
      return "阻塞";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return "待处理";
  }
}

function parseGitDirective(resultJson: Record<string, unknown> | null | undefined): GitAutomationDirective | null {
  const record = asRecord(resultJson?.paperclipGit);
  if (!record) return null;
  return {
    enabled: asBoolean(record.enabled),
    message: readNonEmptyString(record.message),
    authorName: readNonEmptyString(record.authorName),
    authorEmail: readNonEmptyString(record.authorEmail),
    paths: asStringArray(record.paths),
    push: asBoolean(record.push),
    cwd: readNonEmptyString(record.cwd),
    branch: readNonEmptyString(record.branch),
  };
}

function parseTapdDirective(resultJson: Record<string, unknown> | null | undefined): TapdAutomationDirective | null {
  const record = asRecord(resultJson?.paperclipTapd);
  if (!record) return null;
  return {
    enabled: asBoolean(record.enabled),
    status: readNonEmptyString(record.status),
    fields: asRecord(record.fields),
  };
}

function shouldWakeIssue(issueStatus: string) {
  return !["done", "cancelled"].includes(issueStatus);
}

export function externalWorkAutomationService(
  db: Db,
  deps?: {
    externalWork?: Pick<
      ReturnType<typeof externalWorkService>,
      "sync" | "listItems" | "getIntegrationById"
    >;
    gitee?: Pick<
      ReturnType<typeof giteeIntegrationService>,
      "normalizeConfigForPersistence" | "syncBindings" | "ensureWorkspaceRepo" | "commitAndPushWorkspace"
    >;
    tapd?: Pick<
      ReturnType<typeof tapdIntegrationService>,
      "normalizeConfigForPersistence" | "updateBug" | "updateTask"
    >;
    issues?: Pick<ReturnType<typeof issueService>, "getById" | "update">;
    heartbeatWakeup?: HeartbeatWakeupFn;
    logActivityFn?: typeof logActivity;
    now?: () => Date;
  },
) {
  const externalWork = deps?.externalWork ?? externalWorkService(db);
  const gitee = deps?.gitee ?? giteeIntegrationService(db);
  const tapd = deps?.tapd ?? tapdIntegrationService(db);
  const issuesSvc = deps?.issues ?? issueService(db);
  const heartbeatWakeup = deps?.heartbeatWakeup;
  const logActivityFn = deps?.logActivityFn ?? logActivity;
  const now = deps?.now ?? (() => new Date());

  async function listEnabledIntegrations(
    companyId?: string,
    provider?: ExternalWorkIntegrationRow["provider"],
  ) {
    const conditions = [eq(externalWorkIntegrations.enabled, true)];
    if (companyId) conditions.push(eq(externalWorkIntegrations.companyId, companyId));
    if (provider) conditions.push(eq(externalWorkIntegrations.provider, provider));
    return db
      .select()
      .from(externalWorkIntegrations)
      .where(and(...conditions))
      .orderBy(desc(externalWorkIntegrations.createdAt));
  }

  async function listProjectWorkspaceRows(companyId: string, projectId: string) {
    return db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.companyId, companyId),
          eq(projectWorkspaces.projectId, projectId),
        ),
      )
      .orderBy(desc(projectWorkspaces.isPrimary), desc(projectWorkspaces.createdAt));
  }

  async function listLinkedItems(companyId: string, issueId: string) {
    return db
      .select()
      .from(externalWorkItems)
      .where(
        and(
          eq(externalWorkItems.companyId, companyId),
          eq(externalWorkItems.linkedIssueId, issueId),
        ),
      )
      .orderBy(desc(externalWorkItems.updatedAt));
  }

  async function insertItemEvent(
    companyId: string,
    externalWorkItemId: string,
    input: {
      eventType: string;
      summary: string;
      payload?: Record<string, unknown> | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    },
  ) {
    await db.insert(externalWorkItemEvents).values({
      companyId,
      externalWorkItemId,
      eventType: input.eventType,
      summary: input.summary,
      payload: input.payload ?? {},
      createdByAgentId: input.createdByAgentId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
  }

  async function touchItem(
    item: ExternalWorkItemRow,
    patch: Partial<typeof externalWorkItems.$inferInsert>,
  ) {
    const [updated] = await db
      .update(externalWorkItems)
      .set({
        ...patch,
        updatedAt: now(),
      })
      .where(eq(externalWorkItems.id, item.id))
      .returning();
    return updated ?? item;
  }

  async function touchIntegration(
    integrationId: string,
    patch: Partial<typeof externalWorkIntegrations.$inferInsert>,
  ) {
    await db
      .update(externalWorkIntegrations)
      .set({
        ...patch,
        updatedAt: now(),
      })
      .where(eq(externalWorkIntegrations.id, integrationId));
  }

  function normalizeActor(actor?: AutomationActor): AutomationActor {
    return {
      actorType: actor?.actorType ?? "system",
      actorId: actor?.actorId ?? "external_work_automation",
      agentId: actor?.agentId ?? null,
      userId: actor?.userId ?? null,
      runId: actor?.runId ?? null,
      invocation: actor?.invocation ?? "manual",
    };
  }

  async function resolveMatchingGiteeBinding(
    companyId: string,
    projectId: string,
    preferredWorkspaceId: string | null,
  ) {
    const integrations = await listEnabledIntegrations(companyId, "gitee");
    for (const integration of integrations) {
      const config = await gitee.normalizeConfigForPersistence(
        integration.companyId,
        integration.config,
      );
      const binding =
        config.repoBindings.find(
          (item) =>
            item.enabled !== false &&
            preferredWorkspaceId &&
            item.targetWorkspaceId === preferredWorkspaceId,
        ) ??
        config.repoBindings.find(
          (item) =>
            item.enabled !== false &&
            item.targetProjectId === projectId,
        ) ??
        null;
      if (binding) {
        return {
          integration,
          binding,
        };
      }
    }
    return null;
  }

  function selectWorkspaceIdForBinding(
    workspaces: Array<Pick<ProjectWorkspace, "id" | "projectId" | "repoUrl" | "metadata" | "isPrimary">>,
    binding: GiteeRepoBinding,
    integrationId: string,
    projectId: string,
    preferredWorkspaceId: string | null,
  ) {
    return (
      (preferredWorkspaceId &&
        workspaces.find((workspace) => workspace.id === preferredWorkspaceId)?.id) ??
      (binding.targetWorkspaceId &&
        workspaces.find((workspace) => workspace.id === binding.targetWorkspaceId)?.id) ??
      workspaces.find(
        (workspace) => extractWorkspaceBindingIntegrationId(workspace) === integrationId,
      )?.id ??
      workspaces.find(
        (workspace) =>
          workspace.projectId === projectId &&
          workspace.repoUrl === binding.repoUrl,
      )?.id ??
      workspaces.find((workspace) => workspace.projectId === projectId && workspace.isPrimary)?.id ??
      workspaces.find((workspace) => workspace.projectId === projectId)?.id ??
      null
    );
  }

  async function resolveWorkspaceBinding(input: {
    companyId: string;
    projectId: string;
    preferredWorkspaceId: string | null;
    actor?: AutomationActor;
  }) {
    const projectWorkspaces = await listProjectWorkspaceRows(input.companyId, input.projectId);
    const preferredWorkspace =
      (input.preferredWorkspaceId
        ? projectWorkspaces.find((workspace) => workspace.id === input.preferredWorkspaceId) ?? null
        : null) ??
      projectWorkspaces[0] ??
      null;
    const integrationIdFromWorkspace = extractWorkspaceBindingIntegrationId(preferredWorkspace);

    if (integrationIdFromWorkspace && preferredWorkspace) {
      return {
        integrationId: integrationIdFromWorkspace,
        workspaceId: preferredWorkspace.id,
      };
    }

    const matched = await resolveMatchingGiteeBinding(
      input.companyId,
      input.projectId,
      input.preferredWorkspaceId,
    );
    if (!matched) return null;

    let workspaceId = selectWorkspaceIdForBinding(
      projectWorkspaces,
      matched.binding,
      matched.integration.id,
      input.projectId,
      input.preferredWorkspaceId,
    );

    if (!workspaceId) {
      const syncResult = await gitee.syncBindings(
        matched.integration.id,
        normalizeActor(input.actor),
      );
      workspaceId = selectWorkspaceIdForBinding(
        syncResult.workspaces,
        matched.binding,
        matched.integration.id,
        input.projectId,
        input.preferredWorkspaceId,
      );
    }

    if (!workspaceId) return null;
    return {
      integrationId: matched.integration.id,
      workspaceId,
    };
  }

  async function kickoffMappedIssueExecution(
    item: ExternalWorkItemRow,
    actor?: AutomationActor,
  ) {
    if (!heartbeatWakeup || !item.linkedIssueId) return false;

    let issue = await issuesSvc.getById(item.linkedIssueId);
    if (!issue || !issue.assigneeAgentId || !shouldWakeIssue(issue.status)) {
      return false;
    }

    if (issue.status === "backlog") {
      issue = (await issuesSvc.update(issue.id, { status: "todo" })) ?? issue;
    }
    const assigneeAgentId = issue.assigneeAgentId;
    if (!assigneeAgentId) return false;

    await heartbeatWakeup(assigneeAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "external_work_execution_kickoff",
      payload: {
        externalWorkItemId: item.id,
        issueId: issue.id,
        integrationId: item.integrationId,
        externalType: item.externalType,
        externalId: item.externalId,
      },
      requestedByActorType: actor?.actorType ?? "system",
      requestedByActorId: actor?.actorId ?? "external_work_automation",
      contextSnapshot: {
        issueId: issue.id,
        taskId: issue.id,
        projectId: issue.projectId ?? item.linkedProjectId ?? null,
        externalWork: {
          itemId: item.id,
          integrationId: item.integrationId,
          provider: item.provider,
          externalType: item.externalType,
          externalId: item.externalId,
        },
        source: "external_work.sync",
        wakeReason: "external_work_execution_kickoff",
      },
    });

    await insertItemEvent(item.companyId, item.id, {
      eventType: "external_work_item.execution_kicked_off",
      summary: `Queued issue execution for external work item ${item.externalType} ${item.externalId}`,
      payload: {
        issueId: issue.id,
        assigneeAgentId,
      },
      createdByAgentId: actor?.agentId ?? null,
      createdByUserId: actor?.userId ?? null,
    });

    await logActivityFn(db, {
      companyId: item.companyId,
      actorType: actor?.actorType ?? "system",
      actorId: actor?.actorId ?? "external_work_automation",
      agentId: actor?.agentId ?? null,
      runId: actor?.runId ?? null,
      action: "external_work_item.execution_kicked_off",
      entityType: "external_work_item",
      entityId: item.id,
      details: {
        issueId: issue.id,
        assigneeAgentId,
      },
    });

    return true;
  }

  return {
    tickScheduler: async (tickNow = now()): Promise<ExternalWorkSchedulerResult> => {
      const integrations = await listEnabledIntegrations(undefined, "tapd");
      let checked = 0;
      let synced = 0;
      let woken = 0;
      let failed = 0;

      for (const integration of integrations) {
        const config = await tapd.normalizeConfigForPersistence(
          integration.companyId,
          integration.config,
        );
        if (!config.schedule.enabled || config.schedule.intervalMinutes <= 0) continue;

        checked += 1;
        const baseline = new Date(integration.lastSyncedAt ?? integration.createdAt).getTime();
        const elapsedMinutes = (tickNow.getTime() - baseline) / 60_000;
        if (elapsedMinutes < config.schedule.intervalMinutes) continue;

        const actor = normalizeActor({
          actorType: "system",
          actorId: "external_work_scheduler",
          invocation: "scheduler",
        });
        const threshold = new Date(tickNow.getTime() - 1000);
        try {
          await externalWork.sync(integration.id, actor);
          synced += 1;

          const syncedItems = await externalWork.listItems(integration.companyId, integration.id);
          const recentItems = syncedItems.filter(
            (item) =>
              Boolean(item.linkedIssueId) &&
              Boolean(item.lastSyncedAt) &&
              (item.lastSyncedAt?.getTime() ?? 0) >= threshold.getTime(),
          );
          for (const item of recentItems) {
            const triggered = await kickoffMappedIssueExecution(item, actor);
            if (triggered) woken += 1;
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : "External work scheduler failed";
          await touchIntegration(integration.id, {
            lastError: message,
          });
        }
      }

      return {
        checked,
        synced,
        woken,
        failed,
      };
    },

    prepareRun: async (input: ExternalWorkPrepareRunInput): Promise<ExternalWorkPrepareRunResult> => {
      const issueId = readNonEmptyString(input.issueId);
      const projectId = readNonEmptyString(input.projectId);
      if (!projectId) {
        return {
          warnings: [],
          repoPrepared: null,
        };
      }

      const actor = normalizeActor({
        actorType: input.agentId ? "agent" : "system",
        actorId: input.agentId ?? "external_work_automation",
        agentId: input.agentId ?? null,
        runId: input.runId ?? null,
        invocation: resolveAutomationInvocation(input.invocationSource),
      });
      const linkedItems =
        issueId ? await listLinkedItems(input.companyId, issueId) : [];
      const preferredWorkspaceId =
        extractTargetWorkspaceId(linkedItems[0]) ?? null;
      const resolved = await resolveWorkspaceBinding({
        companyId: input.companyId,
        projectId,
        preferredWorkspaceId,
        actor,
      });
      if (!resolved) {
        return {
          warnings: [],
          repoPrepared: null,
        };
      }

      try {
        const prepared = await gitee.ensureWorkspaceRepo(
          resolved.integrationId,
          { workspaceId: resolved.workspaceId },
          actor,
        );
        for (const item of linkedItems) {
          await insertItemEvent(item.companyId, item.id, {
            eventType: "external_work_item.repo_prepared",
            summary: `Prepared Gitee repo for issue ${item.linkedIssueId}`,
            payload: {
              workspaceId: prepared.workspace.id,
              cwd: prepared.cwd,
              head: prepared.head,
              branch: prepared.branch,
            },
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
          });
        }
        return {
          warnings: [],
          repoPrepared: prepared,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to prepare Gitee repo";
        for (const item of linkedItems) {
          await touchItem(item, {
            lastError: message,
          });
          await insertItemEvent(item.companyId, item.id, {
            eventType: "external_work_item.repo_prepare_failed",
            summary: `Failed to prepare Gitee repo for ${item.externalType} ${item.externalId}`,
            payload: {
              error: message,
            },
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
          });
        }
        return {
          warnings: [message],
          repoPrepared: null,
        };
      }
    },

    finalizeRun: async (input: ExternalWorkFinalizeRunInput): Promise<ExternalWorkFinalizeRunResult> => {
      const issueId = readNonEmptyString(input.issueId);
      const projectId = readNonEmptyString(input.projectId);
      if (!issueId || !projectId) {
        return {
          warnings: [],
          commitResult: null,
          writebackCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const issue = await issuesSvc.getById(issueId);
      if (!issue) {
        return {
          warnings: [],
          commitResult: null,
          writebackCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const linkedItems = await listLinkedItems(input.companyId, issueId);
      if (linkedItems.length === 0) {
        return {
          warnings: [],
          commitResult: null,
          writebackCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const actor = normalizeActor({
        actorType: input.agentId ? "agent" : "system",
        actorId: input.agentId ?? "external_work_automation",
        agentId: input.agentId ?? null,
        runId: input.runId ?? null,
        invocation: resolveAutomationInvocation(input.invocationSource),
      });
      const warnings: string[] = [];
      let failedCount = 0;
      let skippedCount = 0;
      let writebackCount = 0;
      let commitResult: GiteeWorkspaceCommitPushResult | null = null;

      const gitDirective = parseGitDirective(input.resultJson);
      const tapdDirective = parseTapdDirective(input.resultJson);
      const paperclipWorkspace = asRecord(asRecord(input.contextSnapshot)?.paperclipWorkspace);
      const workspaceId =
        readNonEmptyString(paperclipWorkspace?.workspaceId) ??
        extractTargetWorkspaceId(linkedItems[0]) ??
        null;
      const branchName = readNonEmptyString(paperclipWorkspace?.branchName);
      const workspaceCwd =
        readNonEmptyString(gitDirective?.cwd) ??
        readNonEmptyString(paperclipWorkspace?.worktreePath) ??
        readNonEmptyString(paperclipWorkspace?.cwd);

      const shouldCommitPush =
        input.outcome === "succeeded" &&
        (gitDirective?.enabled === true ||
          (gitDirective?.enabled !== false &&
            (issue.status === "in_review" || issue.status === "done")));

      let commitFailure: string | null = null;
      if (shouldCommitPush && workspaceId) {
        const resolved = await resolveWorkspaceBinding({
          companyId: input.companyId,
          projectId,
          preferredWorkspaceId: workspaceId,
          actor,
        });
        if (resolved) {
          try {
            commitResult = await gitee.commitAndPushWorkspace(
              resolved.integrationId,
              {
                workspaceId: resolved.workspaceId,
                message: gitDirective?.message ?? deriveDefaultCommitMessage(issue),
                authorName: gitDirective?.authorName,
                authorEmail: gitDirective?.authorEmail,
                paths: gitDirective?.paths ?? undefined,
                push: gitDirective?.push ?? true,
                cwd: workspaceCwd,
                branch: gitDirective?.branch ?? branchName,
              },
              actor,
            );
            await touchIntegration(resolved.integrationId, {
              lastWritebackAt: now(),
              lastError: null,
            });
            for (const item of linkedItems) {
              await insertItemEvent(item.companyId, item.id, {
                eventType: "external_work_item.repo_pushed",
                summary: `Committed and pushed repo changes for issue ${issue.identifier ?? issue.id}`,
                payload: {
                  workspaceId: resolved.workspaceId,
                  cwd: commitResult.cwd,
                  branch: commitResult.branch,
                  committed: commitResult.committed,
                  pushed: commitResult.pushed,
                  commitSha: commitResult.commitSha,
                },
                createdByAgentId: actor.agentId ?? null,
                createdByUserId: actor.userId ?? null,
              });
            }
          } catch (error) {
            commitFailure =
              error instanceof Error ? error.message : "Failed to commit and push repo changes";
            warnings.push(commitFailure);
            for (const item of linkedItems) {
              await touchItem(item, {
                lastError: commitFailure,
              });
              await insertItemEvent(item.companyId, item.id, {
                eventType: "external_work_item.repo_push_failed",
                summary: `Failed to push repo changes for ${item.externalType} ${item.externalId}`,
                payload: {
                  error: commitFailure,
                },
                createdByAgentId: actor.agentId ?? null,
                createdByUserId: actor.userId ?? null,
              });
            }
            failedCount += 1;
          }
        }
      }

      for (const item of linkedItems) {
        if (item.provider !== "tapd") continue;

        const integration = await externalWork.getIntegrationById(item.integrationId);
        if (!integration) {
          skippedCount += 1;
          continue;
        }

        if (
          item.externalType !== "task" &&
          item.externalType !== "bug"
        ) {
          await insertItemEvent(item.companyId, item.id, {
            eventType: "external_work_item.writeback_skipped",
            summary: `Skipped TAPD writeback for ${item.externalType} ${item.externalId}`,
            payload: {
              reason: "unsupported_external_type",
            },
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
          });
          skippedCount += 1;
          continue;
        }

        const localIssueStatus = issue.status as IssueStatus;
        const remoteIssueStatus = mapTapdStatusToIssueStatus(item.remoteStatus, {
          hasAssignee: Boolean(issue.assigneeAgentId || issue.assigneeUserId),
        });
        const desiredStatus = tapdDirective?.status ?? mapIssueStatusToTapdStatus(localIssueStatus);
        const patch = {
          ...(tapdDirective?.fields ?? {}),
          ...(desiredStatus ? { status: desiredStatus } : {}),
        };

        const shouldWriteback =
          tapdDirective?.enabled === true ||
          Object.keys(patch).length > 0 && localIssueStatus !== remoteIssueStatus;

        if (
          !shouldWriteback ||
          ((localIssueStatus === "in_review" || localIssueStatus === "done") &&
            commitFailure &&
            tapdDirective?.enabled !== true)
        ) {
          skippedCount += 1;
          continue;
        }

        try {
          const runtimeConfig = await tapd.normalizeConfigForPersistence(
            integration.companyId,
            integration.config,
          );
          if (item.externalType === "task") {
            await tapd.updateTask(
              integration.companyId,
              runtimeConfig,
              item.externalId,
              patch,
            );
          } else {
            await tapd.updateBug(
              integration.companyId,
              runtimeConfig,
              item.externalId,
              patch,
            );
          }
          await touchItem(item, {
            remoteStatus: desiredStatus,
            lastWritebackAt: now(),
            lastError: null,
          });
          await touchIntegration(integration.id, {
            lastWritebackAt: now(),
            lastError: null,
          });
          await insertItemEvent(item.companyId, item.id, {
            eventType: "external_work_item.tapd_writeback_succeeded",
            summary: `Updated TAPD ${item.externalType} ${item.externalId}`,
            payload: {
              patch,
              issueStatus: localIssueStatus,
            },
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
          });
          await logActivityFn(db, {
            companyId: item.companyId,
            actorType: actor.actorType ?? "system",
            actorId: actor.actorId ?? "external_work_automation",
            agentId: actor.agentId ?? null,
            runId: actor.runId ?? null,
            action: "external_work_item.tapd_writeback_succeeded",
            entityType: "external_work_item",
            entityId: item.id,
            details: {
              externalType: item.externalType,
              externalId: item.externalId,
              patch,
            },
          });
          writebackCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "TAPD writeback failed";
          await touchItem(item, {
            lastError: message,
          });
          await touchIntegration(integration.id, {
            lastError: message,
          });
          await insertItemEvent(item.companyId, item.id, {
            eventType: "external_work_item.tapd_writeback_failed",
            summary: `Failed to update TAPD ${item.externalType} ${item.externalId}`,
            payload: {
              error: message,
              patch,
            },
            createdByAgentId: actor.agentId ?? null,
            createdByUserId: actor.userId ?? null,
          });
          await logActivityFn(db, {
            companyId: item.companyId,
            actorType: actor.actorType ?? "system",
            actorId: actor.actorId ?? "external_work_automation",
            agentId: actor.agentId ?? null,
            runId: actor.runId ?? null,
            action: "external_work_item.tapd_writeback_failed",
            entityType: "external_work_item",
            entityId: item.id,
            details: {
              externalType: item.externalType,
              externalId: item.externalId,
              error: message,
            },
          });
          warnings.push(message);
          failedCount += 1;
        }
      }

      return {
        warnings,
        commitResult,
        writebackCount,
        failedCount,
        skippedCount,
      };
    },
  };
}
