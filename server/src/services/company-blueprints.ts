import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companies,
  goals,
  issueLabels,
  issues,
  labels,
  projectGoals,
  projects,
} from "@paperclipai/db";
import type {
  CompanyMetadata,
  CompanySocialSignalSource,
  ZeroPersonRDBlueprintBootstrap,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { deduplicateAgentName } from "./agents.js";
import { getDefaultCompanyGoal } from "./goals.js";
import { resolveProjectNameForUniqueShortname } from "./projects.js";

export const ZERO_PERSON_RD_TEMPLATE_VERSION = "2026-03-13";
export const ZERO_PERSON_RD_FUNNEL_LABELS = {
  discover: "funnel:discover",
  validate: "funnel:validate",
  build: "funnel:build",
  launch: "funnel:launch",
  growth: "funnel:growth",
} as const;
export const ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE =
  "Mine social signals for painful, urgent, and paid-worthy problems";

const ZERO_PERSON_RD_LABEL_COLORS: Record<keyof typeof ZERO_PERSON_RD_FUNNEL_LABELS, string> = {
  discover: "#3b82f6",
  validate: "#8b5cf6",
  build: "#f97316",
  launch: "#22c55e",
  growth: "#ec4899",
};

export const ZERO_PERSON_RD_PROJECT_DEFINITIONS = [
  {
    key: "discover",
    name: "Discover Social Pain Points",
    status: "in_progress",
    roleKey: "pm",
    color: "#3b82f6",
    description:
      "持续从 X、Reddit、Hacker News、GitHub 热门讨论中提炼高频抱怨、强需求和付费意愿信号。",
  },
  {
    key: "validate",
    name: "Validate Commercial Demand",
    status: "planned",
    roleKey: "pm",
    color: "#8b5cf6",
    description:
      "将发现的问题转化为付费验证假设、定价方案、landing page 和用户访谈行动。",
  },
  {
    key: "build",
    name: "Build MVP Experiments",
    status: "planned",
    roleKey: "engineer",
    color: "#f97316",
    description:
      "围绕已验证需求构建最小可收费 MVP，缩短从需求到上线的时间。",
  },
  {
    key: "launch",
    name: "Launch Revenue Tests",
    status: "backlog",
    roleKey: "qa",
    color: "#22c55e",
    description:
      "执行上线前验收、灰度发布、收款检查和核心路径验证，确保可以真实交付与收费。",
  },
  {
    key: "growth",
    name: "Growth Loops & Monetization",
    status: "backlog",
    roleKey: "marketer",
    color: "#ec4899",
    description:
      "围绕内容分发、复购、推荐与社区运营建立增长闭环，持续提升收入密度。",
  },
] as const;

const ZERO_PERSON_RD_AGENT_DEFINITIONS = [
  {
    key: "pm",
    name: "Trend PM",
    role: "pm",
    title: "Trend PM",
    icon: "target",
    reportsTo: null,
    capabilities:
      "负责从 social 渠道发现高价值问题、形成机会判断、安排验证节奏，并协调产品上线闭环。",
  },
  {
    key: "engineer",
    name: "Builder Dev",
    role: "engineer",
    title: "Builder Dev",
    icon: "code",
    reportsTo: "pm",
    capabilities:
      "负责将验证通过的机会快速实现为 MVP、自动化流程与上线资产，优先追求交付速度与可收费性。",
  },
  {
    key: "qa",
    name: "Launch Tester",
    role: "qa",
    title: "Launch Tester",
    icon: "bug",
    reportsTo: "pm",
    capabilities:
      "负责回归验证、收款与转化路径检查、上线前验收，以及关键故障复盘。",
  },
  {
    key: "marketer",
    name: "Growth Marketer",
    role: "marketer",
    title: "Growth Marketer",
    icon: "rocket",
    reportsTo: "pm",
    capabilities:
      "负责内容分发、渠道试验、用户反馈收集和增长/变现闭环，优先验证可复制获客动作。",
  },
] as const;

export const ZERO_PERSON_RD_ISSUE_DEFINITIONS = [
  {
    stage: "discover",
    roleKey: "pm",
    projectKey: "discover",
    status: "todo",
    priority: "high",
    title: ZERO_PERSON_RD_DISCOVER_ISSUE_TITLE,
    description:
      "从 X、Reddit、Hacker News 等渠道收集连续出现的抱怨、替代品不足、明确预算与紧迫交付线索，整理 10 个候选问题并给出优先级。",
  },
  {
    stage: "validate",
    roleKey: "pm",
    projectKey: "validate",
    status: "todo",
    priority: "high",
    title: "Validate willingness to pay before building",
    description:
      "为最高优先级机会设计 landing page、访谈脚本、定价假设和预售/预约行动，明确目标用户、收费点与放弃条件。",
  },
  {
    stage: "build",
    roleKey: "engineer",
    projectKey: "build",
    status: "backlog",
    priority: "high",
    title: "Ship the smallest MVP that can collect revenue",
    description:
      "基于验证结果实现 MVP，覆盖最小功能路径、基础支付/收款入口与核心埋点，避免超出假设范围的开发。",
  },
  {
    stage: "launch",
    roleKey: "qa",
    projectKey: "launch",
    status: "backlog",
    priority: "medium",
    title: "Run launch readiness and revenue-path QA",
    description:
      "检查关键路径：注册、支付、交付、错误提示、邮件/通知和基本容灾，确保 MVP 真正可上线并可收费。",
  },
  {
    stage: "growth",
    roleKey: "marketer",
    projectKey: "growth",
    status: "backlog",
    priority: "medium",
    title: "Launch distribution experiments and monetization loops",
    description:
      "设计首轮内容分发、社区互动、推荐与复购动作，记录 CAC、激活率、首单转化和留存反馈。",
  },
] as const;

type ZeroPersonRDStageKey = keyof typeof ZERO_PERSON_RD_FUNNEL_LABELS;

type FunnelCountRow = {
  labelName: string;
  status: string;
  count: number;
};

type LabelRow = typeof labels.$inferSelect;

function normalizeSocialChannels(
  channels: CompanySocialSignalSource[] | undefined,
): CompanySocialSignalSource[] {
  const fallback: CompanySocialSignalSource[] = ["x", "reddit"];
  if (!channels || channels.length === 0) return fallback;
  return [...new Set(channels)];
}

function mergeZeroPersonMetadata(input: {
  current: CompanyMetadata | null | undefined;
  actorUserId: string | null;
  socialChannels: CompanySocialSignalSource[];
}): CompanyMetadata {
  const now = new Date().toISOString();
  return {
    ...(input.current ?? {}),
    operatingModel: "zero_person_rd",
    templateVersion: ZERO_PERSON_RD_TEMPLATE_VERSION,
    blueprint: {
      key: "zero_person_rd",
      initializedAt: now,
      initializedByUserId: input.actorUserId,
      socialChannels: input.socialChannels,
    },
  };
}

function coerceCompanyMetadata(value: unknown): CompanyMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CompanyMetadata;
}

export function buildZeroPersonRDFunnelSummary(rows: FunnelCountRow[]) {
  const summary = {
    operatingModel: "zero_person_rd" as const,
    discover: 0,
    validate: 0,
    build: 0,
    launch: 0,
    growth: 0,
    shipped: 0,
  };

  const stageByLabel = new Map<string, ZeroPersonRDStageKey>(
    Object.entries(ZERO_PERSON_RD_FUNNEL_LABELS).map(([stage, labelName]) => [
      labelName,
      stage as ZeroPersonRDStageKey,
    ]),
  );

  for (const row of rows) {
    const stage = stageByLabel.get(row.labelName);
    if (!stage) continue;
    if (row.status !== "done" && row.status !== "cancelled") {
      summary[stage] += Number(row.count);
    }
    if (stage === "launch" && row.status === "done") {
      summary.shipped += Number(row.count);
    }
  }

  return summary;
}

async function ensureZeroPersonLabels(tx: any, companyId: string) {
  const labelEntries = Object.entries(ZERO_PERSON_RD_FUNNEL_LABELS) as Array<
    [ZeroPersonRDStageKey, string]
  >;
  const existing = await tx
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.companyId, companyId),
        inArray(
          labels.name,
          labelEntries.map(([, labelName]) => labelName),
        ),
      ),
    );

  const labelMap = new Map<string, LabelRow>(
    existing.map((label: LabelRow) => [label.name, label]),
  );
  for (const [stage, labelName] of labelEntries) {
    if (labelMap.has(labelName)) continue;
    const [created] = await tx
      .insert(labels)
      .values({
        companyId,
        name: labelName,
        color: ZERO_PERSON_RD_LABEL_COLORS[stage],
      })
      .returning();
    labelMap.set(labelName, created);
  }

  return labelMap;
}

function defaultCompanyGoal(goal: string | null | undefined, companyName: string) {
  const trimmed = goal?.trim();
  if (trimmed) return trimmed;
  return `Build profitable indie R&D products for ${companyName} from social demand signals.`;
}

export function companyBlueprintService(db: Db) {
  return {
    bootstrapZeroPersonRD: async (
      companyId: string,
      input: ZeroPersonRDBlueprintBootstrap,
      actorUserId: string | null,
    ) => {
      const existingCompany = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!existingCompany) throw notFound("Company not found");

      const existingMetadata = coerceCompanyMetadata(existingCompany.metadata);
      if (
        existingMetadata?.operatingModel === "zero_person_rd" ||
        existingMetadata?.blueprint?.key === "zero_person_rd"
      ) {
        throw conflict("Zero-person R&D blueprint already initialized for this company");
      }

      const socialChannels = normalizeSocialChannels(input.socialChannels);

      return db.transaction(async (tx) => {
        let companyGoal = await getDefaultCompanyGoal(tx, companyId);
        if (!companyGoal) {
          const [createdGoal] = await tx
            .insert(goals)
            .values({
              companyId,
              title: defaultCompanyGoal(input.goal, existingCompany.name),
              description:
                "围绕 social 热点挖掘、需求验证、研发上线与增长变现建立零人创业闭环。",
              level: "company",
              status: "active",
            })
            .returning();
          companyGoal = createdGoal;
        }

        const existingAgentRows = await tx
          .select({
            id: agents.id,
            name: agents.name,
            status: agents.status,
          })
          .from(agents)
          .where(eq(agents.companyId, companyId));
        const mutableAgentRows = [...existingAgentRows];
        const agentIdByKey = new Map<string, string>();
        const createdAgentIds: string[] = [];

        for (const definition of ZERO_PERSON_RD_AGENT_DEFINITIONS) {
          const uniqueName = deduplicateAgentName(definition.name, mutableAgentRows);
          const [createdAgent] = await tx
            .insert(agents)
            .values({
              companyId,
              name: uniqueName,
              role: definition.role,
              title: definition.title,
              icon: definition.icon,
              status: "idle",
              reportsTo: definition.reportsTo
                ? (agentIdByKey.get(definition.reportsTo) ?? null)
                : null,
              capabilities: definition.capabilities,
              adapterType: "process",
              adapterConfig: {},
              runtimeConfig: {
                heartbeat: {
                  enabled: false,
                  reason: "Configure your preferred adapter before running this role.",
                },
              },
              metadata: {
                blueprintRole: definition.key,
                operatingModel: "zero_person_rd",
              },
            })
            .returning();
          mutableAgentRows.push({
            id: createdAgent.id,
            name: createdAgent.name,
            status: createdAgent.status,
          });
          agentIdByKey.set(definition.key, createdAgent.id);
          createdAgentIds.push(createdAgent.id);
        }

        const existingProjectRows = await tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.companyId, companyId));
        const mutableProjectRows = [...existingProjectRows];
        const projectIdByKey = new Map<string, string>();
        const createdProjectIds: string[] = [];

        for (const definition of ZERO_PERSON_RD_PROJECT_DEFINITIONS) {
          const uniqueName = resolveProjectNameForUniqueShortname(
            definition.name,
            mutableProjectRows,
          );
          const [createdProject] = await tx
            .insert(projects)
            .values({
              companyId,
              goalId: companyGoal.id,
              name: uniqueName,
              description: definition.description,
              status: definition.status,
              leadAgentId: agentIdByKey.get(definition.roleKey) ?? null,
              color: definition.color,
            })
            .returning();
          mutableProjectRows.push({ id: createdProject.id, name: createdProject.name });
          projectIdByKey.set(definition.key, createdProject.id);
          createdProjectIds.push(createdProject.id);
          await tx.insert(projectGoals).values({
            companyId,
            projectId: createdProject.id,
            goalId: companyGoal.id,
          });
        }

        const labelMap = await ensureZeroPersonLabels(tx, companyId);
        const createdIssueIds: string[] = [];

        for (const definition of ZERO_PERSON_RD_ISSUE_DEFINITIONS) {
          const [companyCounter] = await tx
            .update(companies)
            .set({ issueCounter: sql`${companies.issueCounter} + 1` })
            .where(eq(companies.id, companyId))
            .returning({
              issueCounter: companies.issueCounter,
              issuePrefix: companies.issuePrefix,
            });

          const identifier = `${companyCounter.issuePrefix}-${companyCounter.issueCounter}`;
          const [createdIssue] = await tx
            .insert(issues)
            .values({
              companyId,
              projectId: projectIdByKey.get(definition.projectKey) ?? null,
              goalId: companyGoal.id,
              title: definition.title,
              description: `${definition.description}\n\n建议优先覆盖渠道：${socialChannels.join(", ")}。`,
              status: definition.status,
              priority: definition.priority,
              assigneeAgentId: agentIdByKey.get(definition.roleKey) ?? null,
              issueNumber: companyCounter.issueCounter,
              identifier,
              startedAt: null,
            })
            .returning();

          const labelName = ZERO_PERSON_RD_FUNNEL_LABELS[definition.stage];
          const label = labelMap.get(labelName);
          if (label) {
            await tx.insert(issueLabels).values({
              companyId,
              issueId: createdIssue.id,
              labelId: label.id,
            });
          }
          createdIssueIds.push(createdIssue.id);
        }

        const mergedMetadata = mergeZeroPersonMetadata({
          current: existingMetadata,
          actorUserId,
          socialChannels,
        });

        const [company] = await tx
          .update(companies)
          .set({
            metadata: mergedMetadata,
            updatedAt: new Date(),
          })
          .where(eq(companies.id, companyId))
          .returning();

        return {
          company,
          goalId: companyGoal.id,
          createdAgentIds,
          createdProjectIds,
          createdIssueIds,
        };
      });
    },

    summarizeZeroPersonRDFunnel: async (companyId: string) => {
      const rows = await db
        .select({
          labelName: labels.name,
          status: issues.status,
          count: sql<number>`count(*)`,
        })
        .from(issueLabels)
        .innerJoin(labels, eq(issueLabels.labelId, labels.id))
        .innerJoin(issues, eq(issueLabels.issueId, issues.id))
        .where(
          and(
            eq(issueLabels.companyId, companyId),
            inArray(labels.name, Object.values(ZERO_PERSON_RD_FUNNEL_LABELS)),
            isNull(issues.hiddenAt),
          ),
        )
        .groupBy(labels.name, issues.status);

      return buildZeroPersonRDFunnelSummary(
        rows.map((row) => ({
          labelName: row.labelName,
          status: row.status,
          count: Number(row.count),
        })),
      );
    },
  };
}
