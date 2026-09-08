DROP TRIGGER skincare_plan_versions_reject_published_update;

CREATE TRIGGER skincare_plan_versions_reject_published_update
BEFORE UPDATE ON skincare_plan_versions
WHEN OLD.state IN ('published', 'retired')
 AND NOT (
   OLD.effective_to_exclusive IS NULL
   AND NEW.effective_to_exclusive IS NOT NULL
   AND NEW.effective_to_exclusive GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
   AND date(NEW.effective_to_exclusive, '+0 days') IS NEW.effective_to_exclusive
   AND OLD.effective_from IS NOT NULL
   AND NEW.effective_to_exclusive > OLD.effective_from
   AND NEW.id IS OLD.id
   AND NEW.plan_id IS OLD.plan_id
   AND NEW.version IS OLD.version
   AND NEW.state IS OLD.state
   AND NEW.revision IS OLD.revision
   AND NEW.effective_from IS OLD.effective_from
   AND NEW.payload_schema_version IS OLD.payload_schema_version
   AND NEW.canonicalization_version IS OLD.canonicalization_version
   AND NEW.hash_algorithm IS OLD.hash_algorithm
   AND NEW.content_sha256 IS OLD.content_sha256
   AND NEW.snapshot_json IS OLD.snapshot_json
   AND NEW.published_at IS OLD.published_at
   AND NEW.created_at IS OLD.created_at
   AND NEW.updated_at IS OLD.updated_at
 )
BEGIN
  SELECT RAISE(ABORT, 'published skincare plan interval is immutable');
END;

UPDATE app_meta SET value = '7' WHERE key = 'schema_version';
