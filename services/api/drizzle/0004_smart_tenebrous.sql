ALTER TABLE "invite_codes" DROP CONSTRAINT "invite_codes_created_by_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "invite_codes" DROP CONSTRAINT "invite_codes_used_by_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;