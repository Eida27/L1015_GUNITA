CREATE TYPE profile_role AS ENUM ('member','admin');
CREATE TYPE profile_status AS ENUM ('active','suspended');
CREATE TYPE emotion AS ENUM ('love','heartbreak','regret','loneliness','gratitude','hope','happiness','confession','other');
CREATE TYPE thought_status AS ENUM ('published','hidden');
CREATE TYPE reaction_type AS ENUM ('love','sad','care','happy');
CREATE TYPE report_reason AS ENUM ('harassment','private_info','threats','self_harm_encouragement','spam','other');
CREATE TYPE report_status AS ENUM ('open','reviewing','resolved');
CREATE TYPE audit_action AS ENUM ('hide','unhide','delete_thought','suspend','unsuspend','dismiss_report','review_report','bootstrap_admin');
CREATE TYPE audit_subject AS ENUM ('thought','account','report');

CREATE TABLE profiles (
 user_id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 pseudonym text NOT NULL UNIQUE CHECK (pseudonym ~ '^[A-Za-z][A-Za-z0-9-]{7,63}$'),
 role profile_role NOT NULL DEFAULT 'member', status profile_status NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), suspended_at timestamptz
);
CREATE FUNCTION protect_profile_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pseudonym IS DISTINCT FROM OLD.pseudonym OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Permanent profile identity cannot change';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profiles_immutable BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_identity();
CREATE TABLE user_consents (
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 guidelines_version text NOT NULL CHECK (length(guidelines_version) BETWEEN 1 AND 64),
 accepted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,guidelines_version)
);
CREATE TABLE geo_datasets (
 version integer PRIMARY KEY CHECK(version>0), source_id text NOT NULL UNIQUE,
 source_url text NOT NULL, attribution text NOT NULL, license text NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE privacy_tiers (
 tier smallint PRIMARY KEY CHECK(tier IN(5,6,7)), label text NOT NULL UNIQUE,
 algorithm_version integer NOT NULL CHECK(algorithm_version>0)
);
INSERT INTO privacy_tiers VALUES (5,'sparse-island',1),(6,'intermediate',1),(7,'urban',1);
CREATE TABLE geo_admin_areas (
 dataset_version integer NOT NULL REFERENCES geo_datasets(version), source_feature_id text NOT NULL,
 source_label text NOT NULL, public_label text NOT NULL CHECK(length(public_label) BETWEEN 1 AND 100),
 privacy_tier smallint NOT NULL REFERENCES privacy_tiers(tier),
 geom geometry(MultiPolygon,4326) NOT NULL CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom)),
 PRIMARY KEY(dataset_version,source_feature_id)
);
CREATE INDEX geo_admin_areas_geom_gist ON geo_admin_areas USING gist(geom);
CREATE TABLE thoughts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_id text NOT NULL UNIQUE CHECK(public_id ~ '^t_[A-Za-z0-9_-]{22,64}$'),
 author_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(length(body)>0 AND octet_length(body)<=16384), emotion emotion NOT NULL,
 public_point geometry(Point,4326) NOT NULL CHECK(NOT ST_IsEmpty(public_point) AND ST_IsValid(public_point) AND ST_X(public_point) BETWEEN -180 AND 180 AND ST_Y(public_point) BETWEEN -90 AND 90),
 privacy_cell text NOT NULL CHECK(privacy_cell ~ '^[0-9a-f]{15}$'),
 privacy_tier smallint NOT NULL REFERENCES privacy_tiers(tier),
 privacy_algorithm_version integer NOT NULL CHECK(privacy_algorithm_version>0),
 location_label text NOT NULL CHECK(length(location_label) BETWEEN 1 AND 100), location_region_code text,
 status thought_status NOT NULL DEFAULT 'published', created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CONSTRAINT thoughts_expiry CHECK(expires_at=created_at + interval '720 hours')
);
CREATE INDEX thoughts_public_point_gist ON thoughts USING gist(public_point);
CREATE INDEX thoughts_status_expiry_created ON thoughts(status,expires_at,created_at DESC);
CREATE INDEX thoughts_author_expiry ON thoughts(author_id,expires_at DESC);
CREATE FUNCTION protect_thought_lifetime() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Fixed UTC duration, unaffected by session timezone or daylight-saving boundaries.
  NEW.expires_at := NEW.created_at + interval '720 hours';
 ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.public_id IS DISTINCT FROM OLD.public_id
  OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.public_point IS DISTINCT FROM OLD.public_point
  OR NEW.privacy_cell IS DISTINCT FROM OLD.privacy_cell OR NEW.privacy_tier IS DISTINCT FROM OLD.privacy_tier
  OR NEW.privacy_algorithm_version IS DISTINCT FROM OLD.privacy_algorithm_version
  OR NEW.location_label IS DISTINCT FROM OLD.location_label OR NEW.location_region_code IS DISTINCT FROM OLD.location_region_code THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Publication identity, location and lifetime cannot change';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER thoughts_immutable BEFORE INSERT OR UPDATE ON thoughts FOR EACH ROW EXECUTE FUNCTION protect_thought_lifetime();
CREATE TABLE post_quota_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_quota_events_author_time ON post_quota_events(author_id,created_at);
CREATE INDEX post_quota_events_cleanup ON post_quota_events(created_at);
-- No thought FK: deleting content cannot restore its rolling quota.
CREATE FUNCTION record_publication_quota() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.author_id::text,196743));
 IF (SELECT count(*) FROM public.post_quota_events WHERE author_id=NEW.author_id AND created_at>statement_timestamp()-interval '24 hours') >= 5 THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Rolling publication quota reached';
 END IF;
 INSERT INTO public.post_quota_events(author_id) VALUES(NEW.author_id);
 RETURN NEW;
END $$;
CREATE TRIGGER thoughts_quota AFTER INSERT ON thoughts FOR EACH ROW EXECUTE FUNCTION record_publication_quota();
CREATE TABLE reactions (
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE, type reaction_type NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,thought_id)
);
CREATE INDEX reactions_thought ON reactions(thought_id);
CREATE TABLE bookmarks (
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,thought_id)
);
CREATE INDEX bookmarks_thought ON bookmarks(thought_id);
CREATE TABLE reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
 reporter_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL, reason report_reason NOT NULL,
 details text CHECK(length(details)<=500), status report_status NOT NULL DEFAULT 'open',
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 resolved_by uuid REFERENCES "user"(id) ON DELETE SET NULL
);
CREATE INDEX reports_queue ON reports(status,created_at);
CREATE INDEX reports_thought ON reports(thought_id);
CREATE INDEX reports_reporter ON reports(reporter_user_id);
CREATE INDEX reports_resolved_by ON reports(resolved_by);
CREATE TABLE admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
 action audit_action NOT NULL, subject_kind audit_subject NOT NULL,
 subject_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
 subject_thought_id uuid REFERENCES thoughts(id) ON DELETE SET NULL,
 subject_report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 changed_status text CHECK(changed_status IN ('published','hidden','active','suspended','open','reviewing','resolved','member','admin')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(subject_user_id,subject_thought_id,subject_report_id)<=1)
);
CREATE INDEX admin_audit_retention ON admin_audit(created_at);
CREATE INDEX admin_audit_admin ON admin_audit(admin_user_id);
CREATE INDEX admin_audit_subject_user ON admin_audit(subject_user_id);
CREATE INDEX admin_audit_subject_thought ON admin_audit(subject_thought_id);
CREATE INDEX admin_audit_subject_report ON admin_audit(subject_report_id);
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- FK erasure may only clear identifiers. No changing action/reason/status/time.
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action IS DISTINCT FROM OLD.action OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
  OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.changed_status IS DISTINCT FROM OLD.changed_status
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR (NEW.admin_user_id IS NOT NULL AND NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id)
  OR (NEW.subject_user_id IS NOT NULL AND NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id)
  OR (NEW.subject_thought_id IS NOT NULL AND NEW.subject_thought_id IS DISTINCT FROM OLD.subject_thought_id)
  OR (NEW.subject_report_id IS NOT NULL AND NEW.subject_report_id IS DISTINCT FROM OLD.subject_report_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Audit records are append only except identifier erasure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE ON admin_audit FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TABLE rate_limit_counters (
 bucket_hmac text NOT NULL CHECK(bucket_hmac ~ '^[a-f0-9]{64}$'), route_group text NOT NULL CHECK(length(route_group) BETWEEN 1 AND 64),
 window_start timestamptz NOT NULL, count integer NOT NULL CHECK(count>=0), expires_at timestamptz NOT NULL,
 PRIMARY KEY(bucket_hmac,route_group,window_start), CHECK(expires_at>window_start AND expires_at<=window_start+interval '24 hours')
);
CREATE INDEX rate_limit_expiry ON rate_limit_counters(expires_at);
REVOKE EXECUTE ON FUNCTION protect_profile_identity(),protect_thought_lifetime(),record_publication_quota(),audit_append_only() FROM PUBLIC;
