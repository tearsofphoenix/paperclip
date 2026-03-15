import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { externalWorkIntegrations } from "./external_work_integrations.js";

export const externalWorkItems = pgTable(
  "external_work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => externalWorkIntegrations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalType: text("external_type").notNull(),
    externalSpaceId: text("external_space_id"),
    externalProjectId: text("external_project_id"),
    externalIterationId: text("external_iteration_id"),
    externalParentId: text("external_parent_id"),
    externalId: text("external_id").notNull(),
    externalKey: text("external_key"),
    title: text("title").notNull(),
    url: text("url"),
    remoteStatus: text("remote_status"),
    syncStatus: text("sync_status").notNull().default("synced"),
    assigneeName: text("assignee_name"),
    linkedProjectId: uuid("linked_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    linkedIssueId: uuid("linked_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastWritebackAt: timestamp("last_writeback_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIntegrationStatusIdx: index("external_work_items_company_integration_status_idx").on(
      table.companyId,
      table.integrationId,
      table.syncStatus,
    ),
    companyIssueIdx: index("external_work_items_company_issue_idx").on(
      table.companyId,
      table.linkedIssueId,
    ),
    companyProjectIdx: index("external_work_items_company_project_idx").on(
      table.companyId,
      table.linkedProjectId,
    ),
    companyExternalProjectIdx: index("external_work_items_company_external_project_idx").on(
      table.companyId,
      table.externalProjectId,
    ),
    integrationExternalIdUq: uniqueIndex("external_work_items_integration_type_id_uq").on(
      table.integrationId,
      table.externalType,
      table.externalId,
    ),
  }),
);
