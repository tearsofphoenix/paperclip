import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, goals, issues, projects, socialSignals } from "@paperclipai/db";
import type {
  CreateSocialSignal,
  PromoteSocialSignal,
  SocialSignalStatus,
  UpdateSocialSignal,
  ZeroPersonRDStage,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { getDefaultCompanyGoal } from "./goals.js";
import { ZERO_PERSON_RD_PROJECT_DEFINITIONS } from "./company-blueprints.js";

const STAGE_ROLE_MAP: Record<ZeroPersonRDStage, string> = {
  discover: "pm",
  validate: "pm",
  build: "engineer",
  launch: "qa",
  growth: "marketer",
};

type SocialSignalSummaryRow = {
  status: string;
  count: number;
};

export function buildSocialSignalSummary(rows: SocialSignalSummaryRow[]) {
  const summary = {
    new: 0,
    reviewing: 0,
    validated: 0,
    rejected: 0,
    promoted: 0,
  };

  for (const row of rows) {
    const status = row.status as SocialSignalStatus;
    if (!(status in summary)) continue;
    summary[status] = Number(row.count);
  }

  return summary;
}

function derivePromotionStage(input: {
  requestedStage?: ZeroPersonRDStage;
  currentStage?: ZeroPersonRDStage | null;
  status: string;
}): ZeroPersonRDStage {
  if (input.requestedStage) return input.requestedStage;
  if (input.currentStage) return input.currentStage;
  return input.status === "validated" ? "validate" : "discover";
}

function defaultIssueTitle(title: string, source: string) {
  return `[${source}] ${title}`;
}

function buildIssueDescription(signal: typeof socialSignals.$inferSelect) {
  return [
    `Signal source: ${signal.source}`,
    signal.url ? `URL: ${signal.url}` : null,
    signal.authorHandle ? `Author: ${signal.authorHandle}` : null,
    signal.externalId ? `External ID: ${signal.externalId}` : null,
    "",
    signal.summary,
    signal.painPoints ? `\nPain points:\n${signal.painPoints}` : null,
    "",
    `Scores → pain: ${signal.painScore}, urgency: ${signal.urgencyScore}, monetization: ${signal.monetizationScore}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function findStageProject(tx: any, companyId: string, stage: ZeroPersonRDStage) {
  const baseName =
    ZERO_PERSON_RD_PROJECT_DEFINITIONS.find((definition) => definition.key === stage)?.name ?? null;
  if (!baseName) return null;

  const rows = await tx
    .select()
    .from(projects)
    .where(eq(projects.companyId, companyId))
    .orderBy(asc(projects.createdAt));

  return (
    rows.find(
      (project: typeof projects.$inferSelect) =>
        project.name === baseName || project.name.startsWith(`${baseName} `),
    ) ?? null
  );
}

async function findAssigneeAgentId(tx: any, companyId: string, stage: ZeroPersonRDStage) {
  const role = STAGE_ROLE_MAP[stage];
  const row = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.role, role),
        ne(agents.status, "terminated"),
      ),
    )
    .orderBy(asc(agents.createdAt))
    .then((rows: Array<{ id: string }>) => rows[0] ?? null);
  return row?.id ?? null;
}

export function socialSignalService(db: Db) {
  async function getByExternalId(
    companyId: string,
    source: string,
    externalId: string,
  ) {
    return db
      .select()
      .from(socialSignals)
      .where(
        and(
          eq(socialSignals.companyId, companyId),
          eq(socialSignals.source, source),
          eq(socialSignals.externalId, externalId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  const api = {
    list: (companyId: string) =>
      db
        .select()
        .from(socialSignals)
        .where(eq(socialSignals.companyId, companyId))
        .orderBy(desc(socialSignals.createdAt)),

    getById: (id: string) =>
      db
        .select()
        .from(socialSignals)
        .where(eq(socialSignals.id, id))
        .then((rows) => rows[0] ?? null),

    create: async (
      companyId: string,
      data: CreateSocialSignal & {
        autoPromote?: boolean;
        createdByAgentId?: string | null;
        createdByUserId?: string | null;
      },
    ) => {
      if (data.externalId) {
        const duplicate = await getByExternalId(companyId, data.source, data.externalId);
        if (duplicate) {
          throw conflict(`Social signal already exists for ${data.source}:${data.externalId}`);
        }
      }
      const occurredAt =
        typeof data.occurredAt === "string" ? new Date(data.occurredAt) : data.occurredAt ?? null;
      const [created] = await db
        .insert(socialSignals)
        .values({
          companyId,
          source: data.source,
          status: data.status ?? "new",
          targetStage: data.targetStage ?? null,
          title: data.title,
          url: data.url ?? null,
          authorHandle: data.authorHandle ?? null,
          externalId: data.externalId ?? null,
          summary: data.summary,
          painPoints: data.painPoints ?? null,
          painScore: data.painScore ?? 50,
          urgencyScore: data.urgencyScore ?? 50,
          monetizationScore: data.monetizationScore ?? 50,
          occurredAt,
          createdByAgentId: data.createdByAgentId ?? null,
          createdByUserId: data.createdByUserId ?? null,
        })
        .returning();

      if (!data.autoPromote) return created;
      return api.promote(created.id, {
        targetStage: (data.targetStage ?? undefined) as ZeroPersonRDStage | undefined,
      });
    },

    update: async (id: string, data: UpdateSocialSignal) => {
      const existing = await db
        .select()
        .from(socialSignals)
        .where(eq(socialSignals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const patch: Partial<typeof socialSignals.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (data.source !== undefined) patch.source = data.source;
      if (data.status !== undefined) patch.status = data.status;
      if (data.targetStage !== undefined) patch.targetStage = data.targetStage;
      if (data.title !== undefined) patch.title = data.title;
      if (data.url !== undefined) patch.url = data.url ?? null;
      if (data.authorHandle !== undefined) patch.authorHandle = data.authorHandle ?? null;
      if (data.externalId !== undefined) patch.externalId = data.externalId ?? null;
      if (data.summary !== undefined) patch.summary = data.summary;
      if (data.painPoints !== undefined) patch.painPoints = data.painPoints ?? null;
      if (data.painScore !== undefined) patch.painScore = data.painScore;
      if (data.urgencyScore !== undefined) patch.urgencyScore = data.urgencyScore;
      if (data.monetizationScore !== undefined) patch.monetizationScore = data.monetizationScore;
      if (data.occurredAt !== undefined) {
        patch.occurredAt = data.occurredAt ? new Date(data.occurredAt) : null;
      }

      const [updated] = await db
        .update(socialSignals)
        .set(patch)
        .where(eq(socialSignals.id, id))
        .returning();
      return updated ?? null;
    },

    promote: async (id: string, options: PromoteSocialSignal) => {
      const existing = await db
        .select()
        .from(socialSignals)
        .where(eq(socialSignals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Social signal not found");
      if (existing.linkedIssueId) throw conflict("Social signal already promoted");

      return db.transaction(async (tx) => {
        const stage = derivePromotionStage({
          requestedStage: options.targetStage,
          currentStage: existing.targetStage as ZeroPersonRDStage | null,
          status: existing.status,
        });

        const company = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, existing.companyId))
          .then((rows) => rows[0] ?? null);
        if (!company) throw notFound("Company not found");

        const project = await findStageProject(tx, existing.companyId, stage);
        const goal =
          (project?.goalId
            ? await tx
                .select()
                .from(goals)
                .where(eq(goals.id, project.goalId))
                .then((rows) => rows[0] ?? null)
            : null) ?? (await getDefaultCompanyGoal(tx, existing.companyId));

        if (!goal) {
          throw unprocessable("Cannot promote signal without a company goal");
        }

        const assigneeAgentId = await findAssigneeAgentId(tx, existing.companyId, stage);

        const [counter] = await tx
          .update(companies)
          .set({ issueCounter: sql`${companies.issueCounter} + 1` })
          .where(eq(companies.id, existing.companyId))
          .returning({
            issueCounter: companies.issueCounter,
            issuePrefix: companies.issuePrefix,
          });

        const [issue] = await tx
          .insert(issues)
          .values({
            companyId: existing.companyId,
            projectId: project?.id ?? null,
            goalId: goal.id,
            title: defaultIssueTitle(existing.title, existing.source),
            description: buildIssueDescription(existing),
            status: stage === "discover" ? "todo" : "backlog",
            priority:
              existing.painScore >= 75 || existing.monetizationScore >= 75
                ? "high"
                : "medium",
            assigneeAgentId,
            issueNumber: counter.issueCounter,
            identifier: `${counter.issuePrefix}-${counter.issueCounter}`,
          })
          .returning();

        const [updatedSignal] = await tx
          .update(socialSignals)
          .set({
            status: "promoted",
            targetStage: stage,
            linkedIssueId: issue.id,
            linkedProjectId: project?.id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(socialSignals.id, id))
          .returning();

        return updatedSignal;
      });
    },

    summary: async (companyId: string) => {
      const rows = await db
        .select({
          status: socialSignals.status,
          count: sql<number>`count(*)`,
        })
        .from(socialSignals)
        .where(eq(socialSignals.companyId, companyId))
        .groupBy(socialSignals.status);

      return buildSocialSignalSummary(
        rows.map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
      );
    },
  };

  return api;
}
