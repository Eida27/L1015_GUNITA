Spec compliance: **Issues found.** Phase 4 implements the principal geographic/privacy and map requirements, but colocated thoughts cannot become individually selectable. **Task quality: Needs fixes.**

## Spec compliance

- **Important — terminal aggregates never reveal individual thoughts:** `src/server/geo/pins.ts:63-84`, `src/components/map/map-engine.ts:92-105`. This conflicts with the binding cluster behavior in `docs/specs/IMPLEMENTATION_DESIGN_SPEC.md:63` (clusters eventually reveal individual pins). The map-scoped, bounded accessible alternative permitted by that specification at line 134 is not implemented for aggregate members. See I1.
- The initial geographic tuning follows the controller ruling in `.superpowers/sdd/IMPLEMENTATION_PLAN/progress.md:159`: 1 km² connected-land threshold, escalation through the approved tiers, broad-province fallback, and deletion of original tiny-cell metadata. `src/server/geo/privacy.ts:31-99` and `docs/adr/014-coarse-map-locations.md:7-11` implement/document that decision. I did not treat this explicitly authorized initial threshold as an invented requirement or a formal anonymity guarantee.
- The remaining reviewed Phase 4 scope is present: local licensed fixture/configurable style; world camera/PH focus; manual preview; server-only coarsening; bounded viewport discovery; thought-weighted clusters; keyboard alternative; localization; retry/offline handling; and real PostGIS/browser coverage. Evidence is identified below. Full publishing and thought-detail rendering remain explicitly later-phase work and are not missing Phase 4 implementations.

## Strengths

- **Spatial privacy is deterministic across administrative seams.** `src/server/geo/privacy.ts:46-69` intersects all versioned land with the cell, unions it in a stable order, selects an inland representative from the largest component, and produces only coarse metadata. Lines 72-99 implement conservative escalation/fallback and compute the effective fallback cell instead of retaining the origin cell. `tests/integration/map.test.ts:69-124` exercises real cross-boundary pairs and a real tiny-island fallback, rather than only synthetic polygon mocks.
- **Bulk discovery minimizes fields and conserves thought counts.** `src/server/geo/pins.ts:47-85` bounds grid bins through viewport dimensions, filters before aggregation, returns no body/identity/reaction fields, and sums counts without LIMIT truncation. `src/components/map/map-engine.ts:155-163` and `:207-216` sum/display thought weights rather than MapLibre feature counts. The real 10,000-row assertions in `tests/integration/map.test.ts:126-190` cover bounded features, totals, emotion filtering and output size.
- **The precise-pick boundary is narrow.** `src/app/api/map/preview/route.ts:9-29` requires same origin, rejects query strings, limits strict JSON to 256 bytes, and returns only the safe display point. `src/components/map/map-view.tsx:50-80` sends picks in abortable POST bodies; `:220-228` resets coordinate inputs. Raw-input canaries, no GPS, URL/storage absence and acknowledgment revocation are exercised in `tests/e2e/map.spec.ts:32-85`.
- **Lifecycle and accessibility are deliberate.** `src/app/page.tsx:11-16` keeps the stable lazy loader behind the existing content gate. `src/components/map/map-view.tsx:86-115` disposes/aborts the prior engine on locale changes; `src/components/map/map-engine.ts:55-71` localizes native controls. `src/components/map/map-view.tsx:273-324` supplies bounded keyboard-accessible selection and the existing dialog primitive. Actual rebuilt browser evidence includes language/camera retention, selection/Escape and offline recovery.
- **Local evaluation does not depend on an unapproved provider.** `public/maps/development-style.json:4-9` references a local fixture with attribution; `src/app/api/map/style/route.ts:1-16` supports the operator-configured HTTPS style and fails closed when production lacks it. `scripts/prepare-map-assets.mjs:4-11` packages the installed pinned MapLibre worker. Provider licensing/CSP/usage review is explicitly retained as a launch gate in `docs/verification/phase-4.md:25`.

## Issues

### Critical

None found in this task-scoped review.

### Important

**I1 — Colocated thoughts are permanently trapped in a count-only aggregate.**

- **Location:** `src/server/geo/pins.ts:63-84`; `src/components/map/map-engine.ts:100-105`; `src/components/map/map-view.tsx:281-293`.
- **Behavior:** Every viewport query groups rows into spatial bins at every zoom. Two thoughts with the same stored coarse point always occupy the same bin, and the response strips all their public IDs whenever count is greater than one. Selecting that feature only increases zoom, capped at 18; at the cap it can only recenter on the same point. The accessible list repeats that same zoom action and has no member-discovery path. This is a normal outcome of the deliberately deterministic privacy algorithm, not an exotic coordinate collision: the browser fixture itself places 21/17/19 thoughts at three shared points (`tests/fixtures/map-preview.mjs:88-110`).
- **Impact/requirement:** The required eventual individual-pin selection (`docs/specs/IMPLEMENTATION_DESIGN_SPEC.md:63`) cannot happen for these thoughts. The current publicId-only detail handoff cannot recover members that discovery never identifies. The existing browser test proves one zoom increment and selects separate singleton cities; it does not cover this terminal condition (`tests/e2e/map-clusters.spec.ts:63-95`).
- **Fix:** Add a bounded map-scoped terminal-group discovery/selection path that exposes the members' safe public identifiers and coarse metadata, with pagination if needed. It may use the accessible list allowed by specification line 134; full thought detail still belongs to Phase 5. Preserve no private fields, count conservation, the warning gate and bounded outputs. Do not jitter or reconstruct exact coordinates. Exercise multiple real thoughts at one coarse point through maximum zoom and prove each is reachable without an endless “zoom in” action.

### Minor

**M1 — A rejected replacement pick leaves the previous preview circle visible.**

- **Location:** `src/components/map/map-view.tsx:56-71`; `src/components/map/map-engine.ts:304-325`.
- Starting another pick clears React's preview and its preservation ref, but never clears the MapLibre `preview` source. A valid Philippine preview followed by an ocean/foreign pick leaves the old circle on the map while the picker says the new location is invalid. No precise coordinate is exposed, but the displayed selection and validation state disagree.
- Allow the engine preview operation to clear its source and do so when a new pick invalidates the previous selection. A valid-then-invalid sequence should leave no obsolete preview circle.

**M2 — Historical browser warning noise remains in the verification record.**

- **Location:** `.superpowers/sdd/IMPLEMENTATION_PLAN/task-4-report.md:33` and `:79`.
- An earlier actual Chromium trace reported a GPU ReadPixels performance warning. The amended controller acceptance reports empty warning/error logs, and the inspected final 8-test log has no warning lines. This is a historical, nonblocking observation, not a claim that current app code emits warnings. Retain the distinction and investigate/capture its source if it recurs during the planned performance work; do not conceal it by relabeling earlier output as pristine.

## Cannot verify / controller resolution

- **Future publishing integration:** `docs/verification/phase-4.md:7` correctly requires server-side recomputation before persistence. The diff contains preview and a test-only coarse-storage proof, not the Phase 5 publishing transaction. The controller must carry that contract into Phase 5; this review does not certify future writes.
- **Production geography/provider assurance:** `docs/adr/014-coarse-map-locations.md:3` and `docs/verification/phase-4.md:25` retain geography/privacy and actual provider licensing/attribution/caps/CSP review. The local fixture and implementation are reviewable here; no production provider or formal geographic anonymity assurance can be certified from this diff.
- **Performance:** `docs/verification/phase-4.md:35-37` explicitly records that exact query timing/query-plan measurements were not retained by the reporter. The bounded 10k behavior is evidenced; the API p95 target is not established. The controller has already assigned performance evidence to Phase 8. No suite rerun was used to manufacture missing timing evidence.
- **Runtime/log inventory claims:** The report records canonical DB privileges/inventory and artifact/log scans at `.superpowers/sdd/IMPLEMENTATION_PLAN/task-4-report.md:36-38,74`. Those are controller/implementer runtime receipts, not independently rerun checks in this read-only review. The source boundaries and existing final test summaries were inspected; deployment/proxy logging configuration remains a separate launch responsibility.

## Checks and review boundaries

- Reviewed the supplied package `review-518fda5..4f8b82e.diff` in bounded authored-code passes, with lockfile additions inspected separately. No diff/log regeneration, broad source crawl, helper dispatch, suite rerun or product/index/HEAD/branch mutation. Only this report was written. No changed source file was reread separately.
- **Static asset verification:** Verified the actual local Natural Earth file is byte-for-byte the blob represented by the package; size **838,726 bytes**, SHA256 **6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f**, matching `public/maps/README.md:3-5`. Parsed it successfully as a FeatureCollection of **177** Polygon/MultiPolygon features, all with the style-required NAME property. Inspected documented source/license links and local attribution/style usage. Did not print the coordinate blob, refetch the upstream asset, or mistake this basemap for the Philippine posting authority.
- **Focused unchanged-code risk check — error leaks:** Inspected only `src/lib/api/errors.ts:55-71` for the preview route's imported error handler. It emits generic catalog errors and no-store, not exception contents or coordinates.
- **Focused unchanged-code risk check — body-limit bypass:** Inspected only `src/lib/validation/json.ts:4-48` for the preview route's imported parser. It enforces the actual streamed byte limit, strict supplied schema and generic parse/validation errors.
- **Focused unchanged-code risk check — aggregation visibility:** Inspected `src/server/db/published.mjs:1-4` for the imported publication predicate. It requires published status and expiry later than statement_timestamp, so the map query excludes expired/hidden rows before counting.
- **Existing evidence inspected:** `.local/phase-4-final-vitest.log` final summary confirms **8 files / 93 tests passed**, 175.31s. `.local/phase-4-locale-e2e.log` confirms **8 passed**, one worker, 1.3m, including the named map and public-gate cases. Historical full Browser runs remain **20 passed / 1 failed**, followed by corrected focused evidence, as reported; this review does not relabel them as a full green run. No new test was necessary to establish I1: equal coordinates necessarily share every grid bin and the only aggregate action is visibly capped.

## Assessment

**Task quality: Needs fixes.** The spatial privacy implementation, bounded DTO/query and local evaluation evidence are strong. I1 blocks the Phase 4 discovery contract and should be resolved before Phase 5 consumes it; M1 is a small UI consistency defect and M2 is retained historical noise.
