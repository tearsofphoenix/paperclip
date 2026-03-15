CREATE TABLE "external_work_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_writeback_at" timestamp with time zone,
	"last_error" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_type" text NOT NULL,
	"external_space_id" text,
	"external_project_id" text,
	"external_iteration_id" text,
	"external_parent_id" text,
	"external_id" text NOT NULL,
	"external_key" text,
	"title" text NOT NULL,
	"url" text,
	"remote_status" text,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"assignee_name" text,
	"linked_project_id" uuid,
	"linked_issue_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_writeback_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_work_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"external_work_item_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_work_integrations" ADD CONSTRAINT "external_work_integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_integrations" ADD CONSTRAINT "external_work_integrations_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_integration_id_external_work_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."external_work_integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_items" ADD CONSTRAINT "external_work_items_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_item_events" ADD CONSTRAINT "external_work_item_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_item_events" ADD CONSTRAINT "external_work_item_events_external_work_item_id_external_work_items_id_fk" FOREIGN KEY ("external_work_item_id") REFERENCES "public"."external_work_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_work_item_events" ADD CONSTRAINT "external_work_item_events_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "external_work_integrations_company_provider_idx" ON "external_work_integrations" USING btree ("company_id","provider");
--> statement-breakpoint
CREATE INDEX "external_work_integrations_company_enabled_idx" ON "external_work_integrations" USING btree ("company_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_work_integrations_company_provider_name_uq" ON "external_work_integrations" USING btree ("company_id","provider","name");
--> statement-breakpoint
CREATE INDEX "external_work_items_company_integration_status_idx" ON "external_work_items" USING btree ("company_id","integration_id","sync_status");
--> statement-breakpoint
CREATE INDEX "external_work_items_company_issue_idx" ON "external_work_items" USING btree ("company_id","linked_issue_id");
--> statement-breakpoint
CREATE INDEX "external_work_items_company_project_idx" ON "external_work_items" USING btree ("company_id","linked_project_id");
--> statement-breakpoint
CREATE INDEX "external_work_items_company_external_project_idx" ON "external_work_items" USING btree ("company_id","external_project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_work_items_integration_type_id_uq" ON "external_work_items" USING btree ("integration_id","external_type","external_id");
--> statement-breakpoint
CREATE INDEX "external_work_item_events_company_created_idx" ON "external_work_item_events" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "external_work_item_events_item_created_idx" ON "external_work_item_events" USING btree ("external_work_item_id","created_at");
