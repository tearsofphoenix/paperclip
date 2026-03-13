import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const socialSignals = pgTable(
  "social_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    status: text("status").notNull().default("new"),
    targetStage: text("target_stage"),
    title: text("title").notNull(),
    url: text("url"),
    authorHandle: text("author_handle"),
    externalId: text("external_id"),
    summary: text("summary").notNull(),
    painPoints: text("pain_points"),
    painScore: integer("pain_score").notNull().default(50),
    urgencyScore: integer("urgency_score").notNull().default(50),
    monetizationScore: integer("monetization_score").notNull().default(50),
    linkedIssueId: uuid("linked_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    linkedProjectId: uuid("linked_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("social_signals_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    companyStageIdx: index("social_signals_company_stage_idx").on(
      table.companyId,
      table.targetStage,
    ),
    companyIssueIdx: index("social_signals_company_issue_idx").on(
      table.companyId,
      table.linkedIssueId,
    ),
    companyExternalIdUq: uniqueIndex("social_signals_company_source_external_id_uq").on(
      table.companyId,
      table.source,
      table.externalId,
    ),
  }),
);
