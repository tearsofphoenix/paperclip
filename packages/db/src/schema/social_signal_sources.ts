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

export const socialSignalSources = pgTable(
  "social_signal_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    targetStage: text("target_stage"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastCursor: text("last_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProviderIdx: index("social_signal_sources_company_provider_idx").on(
      table.companyId,
      table.provider,
    ),
    companyEnabledIdx: index("social_signal_sources_company_enabled_idx").on(
      table.companyId,
      table.enabled,
    ),
    companyProviderNameUq: uniqueIndex("social_signal_sources_company_provider_name_uq").on(
      table.companyId,
      table.provider,
      table.name,
    ),
  }),
);
