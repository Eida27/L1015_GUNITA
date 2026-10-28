**[P2] Make the quota trigger safe for fixed transaction snapshots — ADDRESSED.** `src/server/db/migrations/0005_publication_isolation.sql:7` rejects every isolation setting other than READ COMMITTED with SQLSTATE `25000` before the account lock, quota count or ledger insert. The new migration preserves the security-definer/search-path contract (`:5`) and existing rolling quota logic (`:10`). The supplied fix package changes none of migrations 0001–0004. `README.md:80` documents the supported mode, rollback requirement and later-service obligation.

**Regression check:** `tests/integration/database.test.mjs:478` covers REPEATABLE READ, SERIALIZABLE and READ UNCOMMITTED. It establishes all six transactions with ledger reads before dispatching any inserts (`:491`), then asserts six `25000` rejections and zero thoughts/events (`:524`). The READ COMMITTED race explicitly sets the supported isolation (`:446`) and retains the five-success/one-`23514` assertions (`:462`).

**Evidence check:** The appended implementer report identifies the focused RED command and its one intended failure/six committed rows, then the GREEN integration command with 35/35 passed, no skips, exit 0, and the mode-specific outcomes. These reported results agree with the amended test assertions. They were not independently rerun. No code doubt required another test run.

**New Breakage in the Fix Diff:** None. The latest-inventory test now selects the latest migration, and the rollback fixture uses version 9999 to avoid the new version 0005. The fix adds no coordinate storage, expiry mutation or runtime privilege grant.

**Out-of-Scope Observations:** None.

**Checks performed:** Read the task brief, original finding/report, appended fix evidence and supplied fix package; checked line references in the amended SQL and regression. No Git commands, suites or product mutations were performed. Only this requested review report was written.

**Fix round:** All findings addressed, no new Critical/Important breakage. No open findings.
