-- A NULL legacy identity cannot distinguish a guest from a deleted member.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM reports WHERE reporter_user_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy report category is ambiguous; operator classification required';
  END IF;
END $$;

ALTER TABLE reports ADD COLUMN reporter_category text;
UPDATE reports SET reporter_category='member' WHERE reporter_user_id IS NOT NULL;
ALTER TABLE reports ALTER COLUMN reporter_category SET NOT NULL;
ALTER TABLE reports ADD CONSTRAINT reports_category_check
  CHECK (reporter_category IN ('guest','member'));
ALTER TABLE reports ADD CONSTRAINT reports_guest_identity_check
  CHECK (reporter_category='member' OR reporter_user_id IS NULL);

CREATE FUNCTION preserve_reporter_category() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.reporter_category IS DISTINCT FROM OLD.reporter_category THEN
    RAISE EXCEPTION 'Original reporter category is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reports_category_immutable BEFORE UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION preserve_reporter_category();
