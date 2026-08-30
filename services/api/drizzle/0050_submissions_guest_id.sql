ALTER TABLE "submissions" ADD COLUMN "guest_id" text REFERENCES "guests"(id) ON DELETE SET NULL;
