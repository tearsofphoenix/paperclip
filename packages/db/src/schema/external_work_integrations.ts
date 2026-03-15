import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const externalWorkIntegrations = pgTable(
  "external_work_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastCursor: text("last_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastWritebackAt: timestamp("last_writeback_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProviderIdx: index("external_work_integrations_company_provider_idx").on(
      table.companyId,
      table.provider,
    ),
    companyEnabledIdx: index("external_work_integrations_company_enabled_idx").on(
      table.companyId,
      table.enabled,
    ),
    companyProviderNameUq: uniqueIndex(
      "external_work_integrations_company_provider_name_uq",
    ).on(table.companyId, table.provider, table.name),
  }),
);
