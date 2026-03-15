import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  externalWorkIntegrations,
  externalWorkItemEvents,
  externalWorkItems,
} from "@paperclipai/db";
import type {
  CreateExternalWorkIntegration,
  ExternalWorkIntegration,
  ExternalWorkIntegrationConfig,
  ExternalWorkIntegrationProvider,
  ExternalWorkItem,
  ExternalWorkItemType,
  GiteeExternalWorkIntegrationConfig,
  IssueStatus,
  TapdExternalWorkIntegrationConfig,
  TapdProjectBinding,
  UpdateExternalWorkIntegration,
} from "@paperclipai/shared";
import { externalWorkItemSchema } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { giteeIntegrationService } from "./gitee-integration.js";
import type {
  TapdIterationRecord,
  TapdWorkItemRecord,
  TapdWorkspaceRecord,
} from "./tapd-integration.js";
import { tapdIntegrationService } from "./tapd-integration.js";
import { issueService } from "./issues.js";

const DEFAULT_TAPD_ITEM_TYPES: ExternalWorkItemType[] = [
  "iteration",
  "story",
  "task",
  "bug",
];

type ExternalWorkIntegrationRow = typeof externalWorkIntegrations.$inferSelect;
type ExternalWorkItemRow = typeof externalWorkItems.$inferSelect;
type ExternalWorkSyncActor = {
  actorType?: "user" | "agent" | "system";
  actorId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
  invocation?: "manual" | "scheduler";
};

interface ExternalWorkSyncResult {
  integration: ExternalWorkIntegration;
  fetchedCount: number;
  syncedCount: number;
  mappedCount: number;
  failedCount: number;
}

interface TapdSyncCandidate {
  provider: "tapd";
  externalType: ExternalWorkItemType;
  externalId: string;
  externalKey: string | null;
  externalSpaceId: string | null;
  externalProjectId: string | null;
  externalIterationId: string | null;
  externalParentId: string | null;
  title: string;
  url: string | null;
  remoteStatus: string | null;
  assigneeName: string | null;
  metadata: Record<string, unknown>;
  targetProjectId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTapdBindings(config: TapdExternalWorkIntegrationConfig) {
  const explicitBindings = config.projectBindings.filter((binding) => binding.enabled !== false);
  if (explicitBindings.length > 0) return explicitBindings;
  return config.workspaceIds.map(
    (workspaceId) =>
      ({
        workspaceId,
        projectId: null,
        iterationId: null,
        targetProjectId: null,
        targetWorkspaceId: null,
        itemTypes: DEFAULT_TAPD_ITEM_TYPES,
        enabled: true,
      }) satisfies TapdProjectBinding,
  );
}

export function mapTapdStatusToIssueStatus(
  remoteStatus: string | null,
  opts?: { hasAssignee?: boolean },
): IssueStatus {
  const normalized = remoteStatus?.trim().toLowerCase() ?? "";
  if (!normalized) return "todo";

  if (
    /(done|closed|resolved|complete|completed|released|fixed|结束|关闭|已关闭|已完成|完成|解决)/.test(
      normalized,
    )
  ) {
    return "done";
  }
  if (/(review|verify|验收|提测|测试中|待验证)/.test(normalized)) {
    return "in_review";
  }
  if (/(block|blocked|阻塞|卡住)/.test(normalized)) {
    return "blocked";
  }
  if (/(cancel|cancelled|canceled|作废|取消)/.test(normalized)) {
    return "cancelled";
  }
  if (/(doing|progress|active|开发中|进行中|处理中|修复中)/.test(normalized)) {
    return opts?.hasAssignee ? "in_progress" : "todo";
  }
  if (/(backlog|pending|open|new|todo|待处理|待办|规划中)/.test(normalized)) {
    return "todo";
  }
  return "todo";
}

export function buildImportedIssueDescription(candidate: TapdSyncCandidate) {
  const lines = [
    `Imported from TAPD ${candidate.externalType.toUpperCase()}: ${candidate.externalId}`,
    candidate.url ? `Remote URL: ${candidate.url}` : null,
    candidate.externalSpaceId ? `Workspace ID: ${candidate.externalSpaceId}` : null,
    candidate.externalProjectId ? `Project ID: ${candidate.externalProjectId}` : null,
    candidate.externalIterationId ? `Iteration ID: ${candidate.externalIterationId}` : null,
    candidate.remoteStatus ? `Remote status: ${candidate.remoteStatus}` : null,
    candidate.assigneeName ? `Remote owner: ${candidate.assigneeName}` : null,
    "",
    typeof candidate.metadata.description === "string" && candidate.metadata.description.trim().length > 0
      ? candidate.metadata.description.trim()
      : "Imported from TAPD external work integration.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

function workspaceCandidate(
  workspace: TapdWorkspaceRecord,
  binding: TapdProjectBinding,
): TapdSyncCandidate {
  return {
    provider: "tapd",
    externalType: "workspace",
    externalId: workspace.id,
    externalKey: workspace.id,
    externalSpaceId: workspace.id,
    externalProjectId: null,
    externalIterationId: null,
    externalParentId: null,
    title: workspace.name,
    url: workspace.url,
    remoteStatus: workspace.status,
    assigneeName: workspace.owner ?? workspace.creator,
    metadata: {
      binding,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      raw: workspace.raw,
    },
    targetProjectId: binding.targetProjectId ?? null,
  };
}

function iterationCandidate(
  iteration: TapdIterationRecord,
  binding: TapdProjectBinding,
): TapdSyncCandidate {
  return {
    provider: "tapd",
    externalType: "iteration",
    externalId: iteration.id,
    externalKey: iteration.id,
    externalSpaceId: iteration.workspaceId ?? binding.workspaceId,
    externalProjectId: iteration.projectId,
    externalIterationId: iteration.id,
    externalParentId: null,
    title: iteration.name,
    url: null,
    remoteStatus: iteration.status,
    assigneeName: iteration.owner,
    metadata: {
      binding,
      startAt: iteration.startAt,
      endAt: iteration.endAt,
      createdAt: iteration.createdAt,
      updatedAt: iteration.updatedAt,
      raw: iteration.raw,
    },
    targetProjectId: binding.targetProjectId ?? null,
  };
}

function workItemCandidate(
  item: TapdWorkItemRecord,
  binding: TapdProjectBinding,
): TapdSyncCandidate {
  return {
    provider: "tapd",
    externalType: item.type,
    externalId: item.id,
    externalKey: item.id,
    externalSpaceId: item.workspaceId ?? binding.workspaceId,
    externalProjectId: item.projectId,
    externalIterationId: item.iterationId,
    externalParentId: item.parentId,
    title: item.title,
    url: item.url,
    remoteStatus: item.status,
    assigneeName: item.owner ?? item.creator,
    metadata: {
      binding,
      description: item.description,
      priority: item.priority,
      severity: item.severity,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      raw: item.raw,
    },
    targetProjectId: binding.targetProjectId ?? null,
  };
}

function mergeSyncCandidate(
  existing: TapdSyncCandidate | undefined,
  next: TapdSyncCandidate,
) {
  if (!existing) return next;
  if (!existing.targetProjectId && next.targetProjectId) return next;
  return existing;
}

export function externalWorkService(
  db: Db,
  deps?: {
    tapd?: ReturnType<typeof tapdIntegrationService>;
    gitee?: Pick<ReturnType<typeof giteeIntegrationService>, "normalizeConfigForPersistence">;
    issues?: Pick<ReturnType<typeof issueService>, "create" | "update" | "getById">;
    logActivityFn?: typeof logActivity;
    now?: () => Date;
  },
) {
  const tapd = deps?.tapd ?? tapdIntegrationService(db);
  const gitee = deps?.gitee ?? giteeIntegrationService(db);
  const issuesSvc = deps?.issues ?? issueService(db);
  const logActivityFn = deps?.logActivityFn ?? logActivity;
  const now = deps?.now ?? (() => new Date());

  async function getIntegrationById(id: string) {
    return db
      .select()
      .from(externalWorkIntegrations)
      .where(eq(externalWorkIntegrations.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getIntegrationByName(
    companyId: string,
    provider: ExternalWorkIntegrationProvider,
    name: string,
  ) {
    return db
      .select()
      .from(externalWorkIntegrations)
      .where(
        and(
          eq(externalWorkIntegrations.companyId, companyId),
          eq(externalWorkIntegrations.provider, provider),
          eq(externalWorkIntegrations.name, name),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function normalizeConfigForPersistence(
    companyId: string,
    provider: ExternalWorkIntegrationProvider,
    rawConfig: unknown,
  ): Promise<ExternalWorkIntegrationConfig> {
    if (provider === "tapd") {
      return tapd.normalizeConfigForPersistence(
        companyId,
        rawConfig,
      ) as Promise<TapdExternalWorkIntegrationConfig>;
    }
    if (provider === "gitee") {
      return gitee.normalizeConfigForPersistence(
        companyId,
        rawConfig,
      ) as Promise<GiteeExternalWorkIntegrationConfig>;
    }
    throw unprocessable(`Unsupported external work provider: ${provider}`);
  }

  async function listExistingItems(integrationId: string) {
    return db
      .select()
      .from(externalWorkItems)
      .where(eq(externalWorkItems.integrationId, integrationId));
  }

  async function getItemById(id: string) {
    return db
      .select()
      .from(externalWorkItems)
      .where(eq(externalWorkItems.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function listItemEvents(companyId: string, externalWorkItemId: string) {
    return db
      .select()
      .from(externalWorkItemEvents)
      .where(
        and(
          eq(externalWorkItemEvents.companyId, companyId),
          eq(externalWorkItemEvents.externalWorkItemId, externalWorkItemId),
        ),
      )
      .orderBy(desc(externalWorkItemEvents.createdAt));
  }

  async function createExternalWorkItem(
    companyId: string,
    integrationId: string,
    candidate: TapdSyncCandidate,
    patch?: Partial<ExternalWorkItemRow>,
  ) {
    const payload = externalWorkItemSchema.parse({
      provider: candidate.provider,
      externalType: candidate.externalType,
      externalId: candidate.externalId,
      externalKey: candidate.externalKey,
      externalParentId: candidate.externalParentId,
      externalSpaceId: candidate.externalSpaceId,
      externalProjectId: candidate.externalProjectId,
      externalIterationId: candidate.externalIterationId,
      title: candidate.title,
      url: candidate.url,
      remoteStatus: candidate.remoteStatus,
      syncStatus: patch?.syncStatus ?? "synced",
      assigneeName: candidate.assigneeName,
      linkedProjectId: patch?.linkedProjectId ?? candidate.targetProjectId,
      linkedIssueId: patch?.linkedIssueId ?? null,
      metadata: candidate.metadata,
    });
    const [row] = await db
      .insert(externalWorkItems)
      .values({
        companyId,
        integrationId,
        provider: payload.provider,
        externalType: payload.externalType,
        externalSpaceId: payload.externalSpaceId ?? null,
        externalProjectId: payload.externalProjectId ?? null,
        externalIterationId: payload.externalIterationId ?? null,
        externalParentId: payload.externalParentId ?? null,
        externalId: payload.externalId,
        externalKey: payload.externalKey ?? null,
        title: payload.title,
        url: payload.url ?? null,
        remoteStatus: payload.remoteStatus ?? null,
        syncStatus: payload.syncStatus,
        assigneeName: payload.assigneeName ?? null,
        linkedProjectId: payload.linkedProjectId ?? null,
        linkedIssueId: payload.linkedIssueId ?? null,
        metadata: payload.metadata ?? {},
        lastSyncedAt: now(),
        lastWritebackAt: patch?.lastWritebackAt ?? null,
        lastError: patch?.lastError ?? null,
      })
      .returning();
    return row;
  }

  async function updateExternalWorkItem(
    existing: ExternalWorkItemRow,
    candidate: TapdSyncCandidate,
    patch?: Partial<ExternalWorkItemRow>,
  ) {
    const payload = externalWorkItemSchema.parse({
      provider: candidate.provider,
      externalType: candidate.externalType,
      externalId: candidate.externalId,
      externalKey: candidate.externalKey,
      externalParentId: candidate.externalParentId,
      externalSpaceId: candidate.externalSpaceId,
      externalProjectId: candidate.externalProjectId,
      externalIterationId: candidate.externalIterationId,
      title: candidate.title,
      url: candidate.url,
      remoteStatus: candidate.remoteStatus,
      syncStatus: patch?.syncStatus ?? existing.syncStatus,
      assigneeName: candidate.assigneeName,
      linkedProjectId:
        patch?.linkedProjectId ?? existing.linkedProjectId ?? candidate.targetProjectId,
      linkedIssueId: patch?.linkedIssueId ?? existing.linkedIssueId ?? null,
      metadata: candidate.metadata,
    });
    const [row] = await db
      .update(externalWorkItems)
      .set({
        externalSpaceId: payload.externalSpaceId ?? null,
        externalProjectId: payload.externalProjectId ?? null,
        externalIterationId: payload.externalIterationId ?? null,
        externalParentId: payload.externalParentId ?? null,
        externalKey: payload.externalKey ?? null,
        title: payload.title,
        url: payload.url ?? null,
        remoteStatus: payload.remoteStatus ?? null,
        syncStatus: payload.syncStatus,
        assigneeName: payload.assigneeName ?? null,
        linkedProjectId: payload.linkedProjectId ?? null,
        linkedIssueId: payload.linkedIssueId ?? null,
        metadata: payload.metadata ?? {},
        lastSyncedAt: now(),
        lastWritebackAt: patch?.lastWritebackAt ?? existing.lastWritebackAt ?? null,
        lastError: patch?.lastError ?? null,
        updatedAt: now(),
      })
      .where(eq(externalWorkItems.id, existing.id))
      .returning();
    return row;
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

  async function collectTapdCandidates(
    companyId: string,
    config: TapdExternalWorkIntegrationConfig,
  ) {
    const bindings = normalizeTapdBindings(config);
    const candidates = new Map<string, TapdSyncCandidate>();

    for (const binding of bindings) {
      const filters = {
        ...(binding.projectId ? { project_id: binding.projectId } : {}),
        ...(binding.iterationId ? { iteration_id: binding.iterationId } : {}),
      };

      if (binding.itemTypes.includes("workspace")) {
        const result = await tapd.listWorkspaces(companyId, config, {
          workspaceIds: [binding.workspaceId],
        });
        for (const workspace of result.items) {
          const candidate = workspaceCandidate(workspace, binding);
          candidates.set(
            `${candidate.externalType}:${candidate.externalId}`,
            mergeSyncCandidate(candidates.get(`${candidate.externalType}:${candidate.externalId}`), candidate),
          );
        }
      }

      if (binding.itemTypes.includes("iteration")) {
        const result = await tapd.listIterations(companyId, config, {
          workspaceId: binding.workspaceId,
          filters,
        });
        for (const iteration of result.items) {
          const candidate = iterationCandidate(iteration, binding);
          candidates.set(
            `${candidate.externalType}:${candidate.externalId}`,
            mergeSyncCandidate(candidates.get(`${candidate.externalType}:${candidate.externalId}`), candidate),
          );
        }
      }

      if (binding.itemTypes.includes("story")) {
        const result = await tapd.listStories(companyId, config, {
          workspaceId: binding.workspaceId,
          filters,
        });
        for (const story of result.items) {
          const candidate = workItemCandidate(story, binding);
          candidates.set(
            `${candidate.externalType}:${candidate.externalId}`,
            mergeSyncCandidate(candidates.get(`${candidate.externalType}:${candidate.externalId}`), candidate),
          );
        }
      }

      if (binding.itemTypes.includes("task")) {
        const result = await tapd.listTasks(companyId, config, {
          workspaceId: binding.workspaceId,
          filters,
        });
        for (const task of result.items) {
          const candidate = workItemCandidate(task, binding);
          candidates.set(
            `${candidate.externalType}:${candidate.externalId}`,
            mergeSyncCandidate(candidates.get(`${candidate.externalType}:${candidate.externalId}`), candidate),
          );
        }
      }

      if (binding.itemTypes.includes("bug")) {
        const result = await tapd.listBugs(companyId, config, {
          workspaceId: binding.workspaceId,
          filters,
        });
        for (const bug of result.items) {
          const candidate = workItemCandidate(bug, binding);
          candidates.set(
            `${candidate.externalType}:${candidate.externalId}`,
            mergeSyncCandidate(candidates.get(`${candidate.externalType}:${candidate.externalId}`), candidate),
          );
        }
      }
    }

    return Array.from(candidates.values());
  }

  async function ensureMappedIssue(
    companyId: string,
    candidate: TapdSyncCandidate,
    existing: ExternalWorkItemRow | null,
    actor?: ExternalWorkSyncActor,
  ) {
    if (
      !candidate.targetProjectId ||
      (candidate.externalType !== "story" &&
        candidate.externalType !== "task" &&
        candidate.externalType !== "bug")
    ) {
      return {
        linkedProjectId: existing?.linkedProjectId ?? candidate.targetProjectId,
        linkedIssueId: existing?.linkedIssueId ?? null,
        syncStatus: existing?.linkedIssueId ? ("mapped" as const) : ("synced" as const),
        issueCreated: false,
      };
    }

    const linkedIssue =
      existing?.linkedIssueId ? await issuesSvc.getById(existing.linkedIssueId) : null;
    const issueStatus = mapTapdStatusToIssueStatus(candidate.remoteStatus, {
      hasAssignee: Boolean(linkedIssue?.assigneeAgentId || linkedIssue?.assigneeUserId),
    });

    if (linkedIssue) {
      const updated = await issuesSvc.update(linkedIssue.id, {
        projectId: candidate.targetProjectId,
        title: candidate.title,
        status: issueStatus,
      });
      return {
        linkedProjectId: candidate.targetProjectId,
        linkedIssueId: updated?.id ?? linkedIssue.id,
        syncStatus: "mapped" as const,
        issueCreated: false,
      };
    }

    const created = await issuesSvc.create(companyId, {
      projectId: candidate.targetProjectId,
      title: candidate.title,
      description: buildImportedIssueDescription(candidate),
      status: issueStatus === "in_progress" ? "todo" : issueStatus,
      priority: "medium",
      createdByAgentId: actor?.agentId ?? null,
      createdByUserId: actor?.userId ?? null,
    });
    return {
      linkedProjectId: candidate.targetProjectId,
      linkedIssueId: created.id,
      syncStatus: "mapped" as const,
      issueCreated: true,
    };
  }

  async function syncTapdIntegration(
    integration: ExternalWorkIntegrationRow,
    actor?: ExternalWorkSyncActor,
  ): Promise<ExternalWorkSyncResult> {
    const config = await tapd.normalizeConfigForPersistence(
      integration.companyId,
      integration.config,
    );
    const existingItems = await listExistingItems(integration.id);
    const existingMap = new Map(
      existingItems.map((item) => [`${item.externalType}:${item.externalId}`, item]),
    );
    const candidates = await collectTapdCandidates(integration.companyId, config);

    let syncedCount = 0;
    let mappedCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
      const key = `${candidate.externalType}:${candidate.externalId}`;
      const existing = existingMap.get(key) ?? null;
      try {
        const mapping = await ensureMappedIssue(
          integration.companyId,
          candidate,
          existing,
          actor,
        );
        const row = existing
          ? await updateExternalWorkItem(existing, candidate, {
              linkedProjectId: mapping.linkedProjectId ?? null,
              linkedIssueId: mapping.linkedIssueId ?? null,
              syncStatus: mapping.syncStatus,
            })
          : await createExternalWorkItem(integration.companyId, integration.id, candidate, {
              linkedProjectId: mapping.linkedProjectId ?? null,
              linkedIssueId: mapping.linkedIssueId ?? null,
              syncStatus: mapping.syncStatus,
            });
        existingMap.set(key, row);
        syncedCount += 1;
        if (row.linkedIssueId) mappedCount += 1;
        if (!existing) {
          await insertItemEvent(integration.companyId, row.id, {
            eventType: "external_work_item.synced",
            summary: `Synced TAPD ${candidate.externalType} ${candidate.externalId}`,
            payload: {
              externalType: candidate.externalType,
              externalId: candidate.externalId,
              remoteStatus: candidate.remoteStatus,
            },
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          });
        }
        if (mapping.linkedIssueId) {
          await insertItemEvent(integration.companyId, row.id, {
            eventType: "external_work_item.mapped",
            summary: `Mapped TAPD ${candidate.externalType} ${candidate.externalId} to issue`,
            payload: {
              linkedIssueId: mapping.linkedIssueId,
              linkedProjectId: mapping.linkedProjectId,
              created: mapping.issueCreated,
            },
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          });
        }
      } catch (error) {
        failedCount += 1;
        const errorMessage = error instanceof Error ? error.message : "Sync failed";
        const row = existing
          ? await updateExternalWorkItem(existing, candidate, {
              syncStatus: "failed",
              lastError: errorMessage,
            })
          : await createExternalWorkItem(integration.companyId, integration.id, candidate, {
              syncStatus: "failed",
              lastError: errorMessage,
            });
        existingMap.set(key, row);
        await insertItemEvent(integration.companyId, row.id, {
          eventType: "external_work_item.failed",
          summary: `Failed to sync TAPD ${candidate.externalType} ${candidate.externalId}`,
          payload: {
            error: errorMessage,
          },
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });
      }
    }

    const [updatedIntegration] = await db
      .update(externalWorkIntegrations)
      .set({
        lastSyncedAt: now(),
        lastError:
          failedCount > 0 ? `${failedCount} external work items failed during TAPD sync` : null,
        updatedAt: now(),
      })
      .where(eq(externalWorkIntegrations.id, integration.id))
      .returning();

    await logActivityFn(db, {
      companyId: integration.companyId,
      actorType: actor?.actorType ?? "system",
      actorId: actor?.actorId ?? "external_work_scheduler",
      agentId: actor?.agentId ?? null,
      runId: actor?.runId ?? null,
      action: "external_work_integration.synced",
      entityType: "external_work_integration",
      entityId: integration.id,
      details: {
        provider: integration.provider,
        fetchedCount: candidates.length,
        syncedCount,
        mappedCount,
        failedCount,
        invocation: actor?.invocation ?? "manual",
      },
    });

    return {
      integration: updatedIntegration as unknown as ExternalWorkIntegration,
      fetchedCount: candidates.length,
      syncedCount,
      mappedCount,
      failedCount,
    };
  }

  return {
    listIntegrations: (companyId: string) =>
      db
        .select()
        .from(externalWorkIntegrations)
        .where(eq(externalWorkIntegrations.companyId, companyId))
        .orderBy(desc(externalWorkIntegrations.createdAt)),

    getIntegrationById,

    normalizeConfigForPersistence,

    create: async (
      companyId: string,
      input: CreateExternalWorkIntegration & {
        createdByAgentId?: string | null;
        createdByUserId?: string | null;
      },
    ) => {
      const duplicate = await getIntegrationByName(companyId, input.provider, input.name);
      if (duplicate) {
        throw conflict(`External work integration already exists: ${input.name}`);
      }

      const normalizedConfig = await normalizeConfigForPersistence(
        companyId,
        input.provider,
        input.config,
      );

      const [created] = await db
        .insert(externalWorkIntegrations)
        .values({
          companyId,
          provider: input.provider,
          name: input.name,
          enabled: input.enabled ?? true,
          config: normalizedConfig as unknown as Record<string, unknown>,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      return created;
    },

    update: async (id: string, input: UpdateExternalWorkIntegration) => {
      const existing = await getIntegrationById(id);
      if (!existing) return null;

      if (input.name && input.name !== existing.name) {
        const duplicate = await getIntegrationByName(
          existing.companyId,
          existing.provider as ExternalWorkIntegrationProvider,
          input.name,
        );
        if (duplicate && duplicate.id !== existing.id) {
          throw conflict(`External work integration already exists: ${input.name}`);
        }
      }

      const normalizedConfig =
        input.config !== undefined
          ? await normalizeConfigForPersistence(
              existing.companyId,
              existing.provider as ExternalWorkIntegrationProvider,
              input.config,
            )
          : (existing.config as unknown as ExternalWorkIntegrationConfig);

      const [updated] = await db
        .update(externalWorkIntegrations)
        .set({
          name: input.name ?? existing.name,
          enabled: input.enabled ?? existing.enabled,
          config: normalizedConfig as unknown as Record<string, unknown>,
          updatedAt: now(),
        })
        .where(eq(externalWorkIntegrations.id, id))
        .returning();
      return updated ?? null;
    },

    listItems: (companyId: string, integrationId?: string) =>
      db
        .select()
        .from(externalWorkItems)
        .where(
          integrationId
            ? and(
                eq(externalWorkItems.companyId, companyId),
                eq(externalWorkItems.integrationId, integrationId),
              )
            : eq(externalWorkItems.companyId, companyId),
        )
        .orderBy(desc(externalWorkItems.updatedAt)),

    getItemById,

    listItemEvents,

    sync: async (integrationId: string, actor?: ExternalWorkSyncActor) => {
      const integration = await getIntegrationById(integrationId);
      if (!integration) throw notFound("External work integration not found");
      if (integration.provider !== "tapd") {
        throw unprocessable(`Unsupported external work provider: ${integration.provider}`);
      }
      return syncTapdIntegration(integration, actor);
    },
  };
}
