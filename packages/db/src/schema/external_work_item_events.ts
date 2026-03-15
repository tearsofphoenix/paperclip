import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { externalWorkItems } from "./external_work_items.js";

export const externalWorkItemEvents = pgTable(
  "external_work_item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalWorkItemId: uuid("external_work_item_id")
      .notNull()
      .references(() => externalWorkItems.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("external_work_item_events_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    itemCreatedIdx: index("external_work_item_events_item_created_idx").on(
      table.externalWorkItemId,
      table.createdAt,
    ),
  }),
);
