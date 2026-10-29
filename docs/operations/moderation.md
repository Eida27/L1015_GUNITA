# Moderation and operator guide

Use a verified active account. Admin role is never accepted from signup/browser input. For local evaluation, register a fictional address, verify via Mailpit, then run in a private operator terminal:

```powershell
pnpm admin:bootstrap --email 'operator@test.invalid' --confirm-email 'operator@test.invalid'
```

Replace both values with the same exact existing verified email. The CLI loads private operator settings, requires role-column privileges and writes a content-free audit. Protect shell history containing the email. Production uses the equivalent operator container command in [deployment](deployment.md), after real email verification.

Open `/admin/reports`, `/admin/accounts` and `/admin/audit`. Every page/API checks the current server role. Pages use private/no-store reads behind acknowledgment; navigation visibility is not the authorization boundary.

| Task              | Operator behavior                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect           | Read reason, bounded details, original guest/member category and nonexpired target context. Minimal account identity inspections audit atomically. Never copy private details into reasons. |
| Review/dismiss    | Mark reviewing/resolved with a fixed justification. Report volume never removes content automatically.                                                                                      |
| Hide/unhide       | Choose justification. Hide immediately makes public detail unavailable. Unhide only nonexpired content; original expiry still applies.                                                      |
| Delete            | Permanently remove live content/dependents only when intended. Prefer reversible hide/unhide for evaluation.                                                                                |
| Suspend/unsuspend | Reported/suspended accounts remain manageable after reports disappear. Suspension revokes sessions and member writes.                                                                       |
| History           | EN/Fil labels and Manila dates include minimal nullable subject/admin refs. Deleted linkage becomes unavailable; audits never copy body/email.                                              |

Permit ordinary non-graphic grief, heartbreak, distress and requests for care unless another rule is violated. Narrow rules reject high-confidence contact/address disclosure, threats/encouragement, obvious links/spam and duplicates with actionable localized errors. See [policy cases/limits](../verification/phase-5-content-policy.md). Human review considers context; there is no AI classifier.

Guest reports require actual Siteverify plus durable attempt/target/replay guards. Official local test keys prove plumbing; production rejects local wrappers/test keys and validates actual hostname/action/time/token uniqueness. Direct mode shares conservative anonymous buckets and ignores spoofed forwarding. Three attempts can exhaust the shared hourly report budget, including later verification failures. This does not prove per-person/IP protection behind a proxy. Production edge controls and incident capacity remain [launch gates](launch-checklist.md).

Investigate failed jobs/old queues through sanitized aggregates; never place raw logs, credentials, body/email or precise coordinates into tickets. Audit retention is 90 days; thought-specific reports cascade on deletion. Reporter category alone survives identity unlinking within report lifetime. Older encrypted backup copies may remain. See [retention](retention.md) and [reconciliation](backups.md).

Help/community/privacy/terms/crisis-resource copy still needs Philippine legal/privacy, operator-contact and native-speaker review before public launch. This guide does not certify that external review.

The Reports queue starts with **Awaiting action**, showing open and reviewing reports oldest first. Use Report view to inspect open, reviewing, resolved or all retained reports; expired targets are excluded in every view. Changing the view resets pagination and action selections. Refresh and a successful action return to the first page. Dismissing a report removes it from Awaiting action while preserving it in Resolved/All until normal deletion. Cursors belong to their selected view; discard an old cursor after updating the application. [Contract and tradeoffs](../adr/016-edit-concurrency-and-report-discovery.md).
