CREATE INDEX IF NOT EXISTS "events_tak_uid_idx" ON "events" USING btree (("data" #>> '{tak,uid}'));
