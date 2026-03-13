CREATE TABLE "social_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"target_stage" text,
	"title" text NOT NULL,
	"url" text,
	"author_handle" text,
	"external_id" text,
	"summary" text NOT NULL,
	"pain_points" text,
	"pain_score" integer DEFAULT 50 NOT NULL,
	"urgency_score" integer DEFAULT 50 NOT NULL,
	"monetization_score" integer DEFAULT 50 NOT NULL,
	"linked_issue_id" uuid,
	"linked_project_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_signals" ADD CONSTRAINT "social_signals_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "social_signals_company_status_idx" ON "social_signals" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "social_signals_company_stage_idx" ON "social_signals" USING btree ("company_id","target_stage");
--> statement-breakpoint
CREATE INDEX "social_signals_company_issue_idx" ON "social_signals" USING btree ("company_id","linked_issue_id");
