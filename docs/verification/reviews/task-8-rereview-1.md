**P8-I01 — Canonicalize and correctly compare backup containment boundaries — ADDRESSED.**

- `scripts/backup-paths.mjs:14-33` resolves the nearest existing ancestor with `realpath` and appends only unresolved descendants. Existing junction/symlink aliases therefore identify their real target even when the final backup directory or key does not exist. Non-ENOENT resolution failures propagate; a dangling link found by `lstat` is rejected rather than treated as an absent ordinary component.
- `scripts/backup-paths.mjs:36-43` compares path segments after Windows case normalization, includes equality, and distinguishes the parent segment `..` / `..` plus separator from an ordinary name beginning with two dots. `scripts/backup-paths.mjs:46-52` rejects the canonical checkout root and its descendants.
- `scripts/backup.mjs:11` and `scripts/backup.mjs:16-22` apply this guard to the CLI key and archive destination and pass the returned canonical paths into the existing operations. The original equality, Windows casing and linked-parent bypasses no longer exist in these changed paths.
- `scripts/backup-lib.mjs:207-210` compares the real archive directory and real key path through the same segment guard. A key named `<destination>/..backup.key` is now rejected before ACL/key loading or dumping.
- `tests/unit/backup-paths.test.mjs:14-28` covers the two-dot filename; `tests/unit/backup-paths.test.mjs:38-65` covers checkout equality, actual Windows case aliases, missing descendants, a real directory junction into the checkout and an allowed external two-dot directory. These assertions match the implemented boundaries rather than merely checking error text from an unrelated guard.

### New Breakage in the Fix Diff

- **Critical:** None found.
- **Important:** None found.
- **Minor:** None found.
- Check: the changed backup-library call remains after realpath resolution and before loading the key. The patch does not change archive ownership, overwrite handling, cryptographic authentication, runtime quarantine or restore cleanup.
- Check: `tests/e2e/moderation.spec.ts:342-357` adds EN/Fil inspection-label assertions while retaining the unavailable-subject and hidden-content checks; it changes no product behavior or prior assertion.
- Check: the documentation preserves the unavailable original label-build shell exit, distinguishes current affected-scenario coverage from earlier distributed E2E coverage, and leaves actual Browser acceptance with the controller. No fresh full-suite or original-build exit-zero claim is introduced.

### Checks and Evidence

- Check: read the task brief, original review and appended fix report, then the supplied `review-e1ec3f8..c4b069d.diff` once for FIX_BASE `e1ec3f8af1d591e5d30ea3358c115e8011054cb5` to HEAD `c4b069d2a58447446fcdaa01bcb46732e49926ef`. Checked current line numbers only for changed backup code and its focused regressions; no Git diff was regenerated.
- Check: inspected `.local/phase-8-path-red.log`: both focused cases failed, with the inside-directory key reaching ACL validation and the canonical helper absent; reporter **2 failed, 12.12s**. The controller supplied actual exit1.
- Check: inspected `.local/phase-8-path-green.log`: covering command names all three files and reports **5/5 across 3 files, 74.18s**. It includes the real dump/isolated restore, partial-write cleanup and authenticated-encryption cases alongside both new path tests. The controller supplied actual exit0. No tests were rerun.
- Check: inspected `.local/phase-8-label-history-e2e.log` and its `.exit`: the affected standalone scenario reports **1 passed, 1.1min, exit0**, consistent with the added EN/Fil assertions. This is scoped artifact evidence, not a substitute for manual acceptance.
- Check: no product, index, HEAD, branch, database or runtime mutation; this scratch report is the only reviewer-written file. No helpers or additional reviewers were dispatched.

### Out-of-Scope Observations

- None newly identified. The previously recorded controller manual Browser/device gate, deployment-only offsite operations and exact historical build/suite attribution remain outside this scoped fix verdict. This report does not certify overall Phase 8 completion.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** P8-I01 is closed; no scoped findings remain open.
