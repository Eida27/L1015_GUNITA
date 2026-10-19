-- Advisory locks serialize writers but cannot refresh a fixed MVCC snapshot.
-- Publication supports READ COMMITTED only; never silently weaken the cap when
-- a caller selects another isolation mode. Keep migrations 0001-0004 unchanged.
CREATE OR REPLACE FUNCTION record_publication_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Publication requires READ COMMITTED isolation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.author_id::text,196743));
 IF (SELECT count(*) FROM public.post_quota_events WHERE author_id=NEW.author_id AND created_at>statement_timestamp()-interval '24 hours') >= 5 THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Rolling publication quota reached';
 END IF;
 INSERT INTO public.post_quota_events(author_id) VALUES(NEW.author_id);
 RETURN NEW;
END $$;
