-- Signup identity and profile are one database statement, including collision retry.
CREATE FUNCTION generate_account_pseudonym() RETURNS text
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT 'QuietLantern-' || substr(replace(gen_random_uuid()::text,'-',''),1,24)
$$;
CREATE FUNCTION create_account_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate text;
BEGIN
 FOR attempt IN 1..8 LOOP
  candidate := public.generate_account_pseudonym();
  BEGIN
   INSERT INTO public.profiles(user_id,pseudonym) VALUES(NEW.id,candidate);
   UPDATE public."user" SET name=candidate,image=NULL WHERE id=NEW.id;
   RETURN NEW;
  EXCEPTION WHEN unique_violation THEN
   IF attempt=8 THEN RAISE EXCEPTION 'Account identity unavailable' USING ERRCODE='23505'; END IF;
  END;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER account_profile AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION create_account_profile();
REVOKE EXECUTE ON FUNCTION generate_account_pseudonym(),create_account_profile() FROM PUBLIC;
