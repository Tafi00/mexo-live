CREATE TABLE "connect_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"shop_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "legacy_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connect_invites_token_idx" ON "connect_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "connect_invites_shop_idx" ON "connect_invites" USING btree ("shop_id");--> statement-breakpoint
-- Shop nhập từ hệ thống cũ: mặc định chỉ theo dõi cho tới khi chuyển hẳn sang hệ thống mới
UPDATE "shops" SET "legacy_hold" = true WHERE "legacy_id" IS NOT NULL;
