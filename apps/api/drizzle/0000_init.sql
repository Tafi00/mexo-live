CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"parent_id" integer,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shop_limit" integer,
	"concurrent_limit" integer,
	"storage_quota_bytes" bigint,
	"service_expires_on" date,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"actor_name" text NOT NULL,
	"shop_id" integer,
	"target_account_id" integer,
	"code" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"shop_id" integer NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_shop_id_day_pk" PRIMARY KEY("shop_id","day")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"shop_id" integer,
	"server_id" integer,
	"session_id" integer,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"api" text NOT NULL,
	"shop_id" integer,
	"shopee_shop_id" bigint,
	"session_id" bigint,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"error_class" text,
	"request_id" text,
	"duration_ms" integer NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"success" boolean NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"ref" text
);
--> statement-breakpoint
CREATE TABLE "api_daily" (
	"day" date NOT NULL,
	"api" text NOT NULL,
	"shop_id" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 0 NOT NULL,
	"total_ms" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "api_daily_day_api_shop_id_pk" PRIMARY KEY("day","api","shop_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"comment_id" text NOT NULL,
	"user_id" text,
	"username" text,
	"content" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"handled" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_shop_id" integer,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"shopee_session_id" bigint,
	"origin" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_key" text,
	"cover_url" text,
	"template_id" integer,
	"template_name" text,
	"schedule_run_id" integer,
	"created_by" integer,
	"created_by_name" text,
	"state" text DEFAULT 'not_started' NOT NULL,
	"shopee_status" text DEFAULT 'unknown' NOT NULL,
	"stream_state" text DEFAULT 'idle' NOT NULL,
	"server_id" integer,
	"push_url_enc" text,
	"domain_id" bigint,
	"share_url" text,
	"playlist" jsonb,
	"loop" boolean DEFAULT true NOT NULL,
	"video_index" integer,
	"video_position_sec" real,
	"loops" integer DEFAULT 0 NOT NULL,
	"pinned_item_id" bigint,
	"manual_pin_video_index" integer,
	"pin_state" text DEFAULT 'off' NOT NULL,
	"pin_error" text,
	"pin_verified_at" timestamp with time zone,
	"feed_since" timestamp with time zone,
	"feed_lost_at" timestamp with time zone,
	"reply_state" text DEFAULT 'off' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_shopee_sync_at" timestamp with time zone,
	"sync_failures" integer DEFAULT 0 NOT NULL,
	"stuck" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"ended_reason" text,
	"end_requested_at" timestamp with time zone,
	"live_cut_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_shops" (
	"account_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	CONSTRAINT "member_shops_account_id_shop_id_pk" PRIMARY KEY("account_id","shop_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"mode" text NOT NULL,
	"shop_id" integer,
	"service_expires_on" date,
	"owner_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"item_id" bigint NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"sku" text,
	"image_url" text,
	"price" real,
	"original_price" real,
	"currency" text DEFAULT 'VND' NOT NULL,
	"stock" integer,
	"sold" integer,
	"rating" real,
	"likes" integer,
	"item_status" text DEFAULT 'NORMAL' NOT NULL,
	"models" jsonb,
	"extra" jsonb,
	"removed" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reply_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"session_id" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text NOT NULL,
	"answer" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"rule_id" integer,
	"latency_ms" integer,
	"reason" text,
	"actor_id" integer
);
--> statement-breakpoint
CREATE TABLE "reply_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"topic" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample" text DEFAULT '' NOT NULL,
	"answer" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"run_date" date NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"issue" text,
	"issue_detail" text,
	"session_id" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template_id" integer,
	"cover_key" text,
	"repeat" text NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text,
	"key_hint" text,
	"key_state" text DEFAULT 'active' NOT NULL,
	"key_expires_at" timestamp with time zone,
	"suspended" boolean DEFAULT false NOT NULL,
	"version" text,
	"max_streams" integer DEFAULT 0 NOT NULL,
	"running_streams" integer DEFAULT 0 NOT NULL,
	"host" text,
	"ip" text,
	"metrics" jsonb,
	"last_heartbeat_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "session_metric_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewers" integer,
	"likes" integer,
	"comments" integer,
	"orders" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_name_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"shopee_shop_id" bigint NOT NULL,
	"region" text DEFAULT 'VN' NOT NULL,
	"shopee_name" text DEFAULT '' NOT NULL,
	"alias" text,
	"search_text" text DEFAULT '' NOT NULL,
	"owner_id" integer,
	"assignee_id" integer,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"service_expires_on" date,
	"suspended_at" timestamp with time zone,
	"suspend_reason" text,
	"connection" text DEFAULT 'needs_reauth' NOT NULL,
	"connection_error" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"auth_expires_at" timestamp with time zone,
	"token_refreshed_at" timestamp with time zone,
	"livestream_check" text DEFAULT 'unchecked' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"cart_limit" integer DEFAULT 100 NOT NULL,
	"product_sync" jsonb DEFAULT '{"status":"never","loaded":0,"total":0,"syncedAt":null,"errorCode":null}'::jsonb NOT NULL,
	"reply_enabled" boolean DEFAULT false NOT NULL,
	"reply_unmatched" text DEFAULT 'none' NOT NULL,
	"reply_context" text DEFAULT '' NOT NULL,
	"reply_config" jsonb DEFAULT '{"maxPerMinute":6,"perViewerCooldownSec":60,"minGapSec":5,"aiDailyBudget":300,"maxCommentAgeSec":120}'::jsonb NOT NULL,
	"reply_disabled_reason" text,
	"comment_poll" jsonb DEFAULT '{"state":"normal","reason":null,"until":null,"failures":0}'::jsonb NOT NULL,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"server_id" integer,
	"desired" text DEFAULT 'run' NOT NULL,
	"state" text DEFAULT 'waiting_server' NOT NULL,
	"resume_index" integer DEFAULT 0 NOT NULL,
	"video_index" integer,
	"position_sec" real,
	"restarts" integer DEFAULT 0 NOT NULL,
	"command" jsonb,
	"error" text,
	"last_report_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"position" integer NOT NULL,
	"video_id" integer NOT NULL,
	"pins" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"live_title" text,
	"live_description" text,
	"cover_key" text,
	"loop" boolean DEFAULT true NOT NULL,
	"expected_duration_min" integer,
	"reply_mode" text DEFAULT 'inherit' NOT NULL,
	"legacy_id" text,
	"legacy_needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" integer NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"folder_id" integer,
	"name" text NOT NULL,
	"source_file_name" text,
	"file_fingerprint" text,
	"duration_sec" real,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"uploaded_bytes" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"fail_reason" text,
	"storage_key" text,
	"mime" text,
	"width" integer,
	"height" integer,
	"codec" text,
	"bitrate" integer,
	"legacy_id" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_uq" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "activity_logs_at_idx" ON "activity_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_logs_shop_idx" ON "activity_logs" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "activity_logs_target_idx" ON "activity_logs" USING btree ("target_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_key_uq" ON "alerts" USING btree ("key") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "alerts_last_idx" ON "alerts" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "alerts_shop_idx" ON "alerts" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "api_calls_at_idx" ON "api_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "api_calls_api_at_idx" ON "api_calls" USING btree ("api","at");--> statement-breakpoint
CREATE INDEX "api_calls_shop_at_idx" ON "api_calls" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_idx" ON "auth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_uq" ON "comments" USING btree ("session_id","comment_id");--> statement-breakpoint
CREATE INDEX "comments_shop_at_idx" ON "comments" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "live_sessions_shop_idx" ON "live_sessions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "live_sessions_state_idx" ON "live_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "live_sessions_created_idx" ON "live_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_sessions_one_open_uq" ON "live_sessions" USING btree ("shop_id") WHERE state <> 'ended';--> statement-breakpoint
CREATE UNIQUE INDEX "products_shop_item_uq" ON "products" USING btree ("shop_id","item_id");--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "reply_logs_shop_at_idx" ON "reply_logs" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "reply_rules_shop_idx" ON "reply_rules" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_runs_uq" ON "schedule_runs" USING btree ("schedule_id","run_date");--> statement-breakpoint
CREATE INDEX "schedule_runs_status_idx" ON "schedule_runs" USING btree ("status","start_at");--> statement-breakpoint
CREATE INDEX "schedule_runs_shop_idx" ON "schedule_runs" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "schedules_shop_idx" ON "schedules" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "session_events_session_idx" ON "session_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_metric_samples_session_idx" ON "session_metric_samples" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "shop_name_history_shop_idx" ON "shop_name_history" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_shopee_uq" ON "shops" USING btree ("shopee_shop_id");--> statement-breakpoint
CREATE INDEX "shops_owner_idx" ON "shops" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "shops_assignee_idx" ON "shops" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "stream_jobs_session_idx" ON "stream_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "stream_jobs_server_idx" ON "stream_jobs" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "template_items_tpl_idx" ON "template_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "templates_shop_idx" ON "templates" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "video_folders_shop_idx" ON "video_folders" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "videos_shop_idx" ON "videos" USING btree ("shop_id");