CREATE UNIQUE INDEX user_email_case_insensitive ON "user" (lower(email));
CREATE INDEX session_expiry ON session(expires_at);
CREATE INDEX verification_expiry ON verification(expires_at);
-- Trigger owns quota writes. Runtime cannot erase or fabricate the ledger.
ALTER FUNCTION record_publication_quota() SECURITY DEFINER;
