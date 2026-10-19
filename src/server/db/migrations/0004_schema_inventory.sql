-- Extend the guard without rewriting fingerprints recorded by migrations 1-3.
-- The runner validates their existing fingerprint before applying this change.
ALTER TABLE schema_migrations ADD COLUMN relation_inventory jsonb;
