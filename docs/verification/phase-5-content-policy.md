# Initial deterministic publishing checks

These deliberately small rules support the Community Guidelines. They are not a comprehensive moderation classifier or a substitute for reporting and human review. Public launch still requires editorial review of the rules and localized policies.

Publishing/editing trims whitespace and removes U+200B/U+2060/U+FEFF padding while preserving emoji joiners and variation selectors. Empty or invisible-only text, more than 280 grapheme clusters, more than 16,384 UTF-8 bytes, and non-text control characters are rejected. Text remains plain React text; HTML-looking and Markdown-looking input is never parsed. The database independently bounds bytes. Local and `+63` Philippine mobile forms have explicit regression examples; the international prefix does not depend on a word boundary before `+`.

Reject email-like contact details, HTTP(S) links (the initial anti-scam/spam policy), recognizable Philippine mobile contact numbers, direct phrases encouraging suicide, and explicit first-person death threats. NFKC normalization closes simple full-width evasions. Identical content from the same author within the last 24 hours is rejected while the live thought exists. Deleted content still consumes the five-publication rolling quota; the quota ledger never stores bodies. Other risky endpoints retain separate durable limits.

Do not reject ordinary mentions of sadness, suicide, trauma, loss, grief, or emotional crisis. For example, “I feel suicidal but I am reaching out for care.” is permitted; “kill yourself” is rejected. These high-confidence English rules are intentionally limited and may have both misses and false positives. They are not a claim of complete English/Filipino safety coverage. `/help` remains the editorial support destination; no unverified crisis contact is added.

Automatic checks only return generic reason codes. They do not log or copy submitted bodies or original location coordinates. Phase 7 owns reporting/manual moderation and refinement of this policy.
