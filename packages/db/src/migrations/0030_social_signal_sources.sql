CREATE TABLE "social_signal_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"target_stage" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_signal_sources" ADD CONSTRAINT "social_signal_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "social_signal_sources" ADD CONSTRAINT "social_signal_sources_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "social_signal_sources_company_provider_idx" ON "social_signal_sources" USING btree ("company_id","provider");
--> statement-breakpoint
CREATE INDEX "social_signal_sources_company_enabled_idx" ON "social_signal_sources" USING btree ("company_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "social_signal_sources_company_provider_name_uq" ON "social_signal_sources" USING btree ("company_id","provider","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "social_signals_company_source_external_id_uq" ON "social_signals" USING btree ("company_id","source","external_id");
