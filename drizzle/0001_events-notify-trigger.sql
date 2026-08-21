-- Publish every insert on events to the 'events_new' channel. NOTIFY fires on
-- commit only, so subscribers never see rolled-back rows. Payload is just the
-- row id (NOTIFY payloads cap at ~8000 bytes; listeners re-read the row).
CREATE OR REPLACE FUNCTION notify_event_insert() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('events_new', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_notify AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION notify_event_insert();
