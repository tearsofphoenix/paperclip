import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, companies, heartbeatRuns, issues } from "@paperclipai/db";
import { ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE } from "./company-blueprints.js";

export interface LegacyZeroPersonDiscoverIssueRepairFilters {
  companyId?: string | null;
  issueId?: string | null;
}

export interface LegacyZeroPersonDiscoverIssueRepairCandidate {
  issueId: string;
  identifier: string | null;
  companyId: string;
  companyName: string;
  title: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  heartbeatRunCount: number;
  activityRunCount: number;
}

type RepairabilityInput = {
  status: string;
  checkoutRunId: string | null;
  executionRunId: string | null;
  heartbeatRunCount: number;
  activityRunCount: number;
};

function toCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export function shouldRepairLegacyZeroPersonDiscoverIssue(input: RepairabilityInput): boolean {
  if (input.status !== "in_progress") return false;
  if (input.checkoutRunId || input.executionRunId) return false;
  if (input.heartbeatRunCount > 0) return false;
  if (input.activityRunCount > 0) return false;
  return true;
}

export async function listLegacyZeroPersonDiscoverIssueRepairCandidates(
  db: Db,
  filters: LegacyZeroPersonDiscoverIssueRepairFilters = {},
): Promise<LegacyZeroPersonDiscoverIssueRepairCandidate[]> {
  const conditions: SQL[] = [
    eq(issues.title, ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE),
    eq(issues.status, "in_progress"),
    isNull(issues.hiddenAt),
    sql`${companies.metadata} ->> 'operatingModel' = 'zero_person_rd'`,
  ];

  if (filters.companyId) {
    conditions.push(eq(issues.companyId, filters.companyId));
  }
  if (filters.issueId) {
    conditions.push(eq(issues.id, filters.issueId));
  }

  const rows = await db
    .select({
      issueId: issues.id,
      identifier: issues.identifier,
      companyId: issues.companyId,
      companyName: companies.name,
      title: issues.title,
      status: issues.status,
      startedAt: issues.startedAt,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
      checkoutRunId: issues.checkoutRunId,
      executionRunId: issues.executionRunId,
    })
    .from(issues)
    .innerJoin(companies, eq(issues.companyId, companies.id))
    .where(and(...conditions));

  const candidates: LegacyZeroPersonDiscoverIssueRepairCandidate[] = [];
  for (const row of rows) {
    const heartbeatRunRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, row.companyId),
          sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${row.issueId}`,
        ),
      );
    const activityRunRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, row.companyId),
          eq(activityLog.entityType, "issue"),
          eq(activityLog.entityId, row.issueId),
          isNotNull(activityLog.runId),
        ),
      );

    const heartbeatRunCount = toCount(heartbeatRunRows[0]?.count);
    const activityRunCount = toCount(activityRunRows[0]?.count);

    if (
      !shouldRepairLegacyZeroPersonDiscoverIssue({
        status: row.status,
        checkoutRunId: row.checkoutRunId,
        executionRunId: row.executionRunId,
        heartbeatRunCount,
        activityRunCount,
      })
    ) {
      continue;
    }

    candidates.push({
      issueId: row.issueId,
      identifier: row.identifier,
      companyId: row.companyId,
      companyName: row.companyName,
      title: row.title,
      status: row.status,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      heartbeatRunCount,
      activityRunCount,
    });
  }

  return candidates;
}

export async function repairLegacyZeroPersonDiscoverIssues(
  db: Db,
  filters: LegacyZeroPersonDiscoverIssueRepairFilters = {},
) {
  const candidates = await listLegacyZeroPersonDiscoverIssueRepairCandidates(db, filters);
  if (candidates.length === 0) {
    return {
      repairedIssueIds: [] as string[],
      candidates,
    };
  }

  const repairedIssueIds = candidates.map((candidate) => candidate.issueId);
  await db
    .update(issues)
    .set({
      status: "todo",
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(inArray(issues.id, repairedIssueIds));

  return {
    repairedIssueIds,
    candidates,
  };
}
