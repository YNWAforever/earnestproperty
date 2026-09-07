# Daily full collection and differential import

Approved by user: daily full collection plus differential import. Run 28hse agent 540 once daily at 02:17 Asia/Hong_Kong (18:17 UTC previous day) using a standard GitHub Actions Linux runner. No AI, browser runtime or always-on VM. Property.hk remains disabled until its source configuration is independently verified.

Fetch all sale/rent indexes, explicit terminals and details using the existing deterministic worker. Reuse the existing atomic Node bridge and Neon canonical properties; only changed canonical fields write, while observations/receipts and last-observed evidence remain recorded. Preserve staff overrides, UUIDs, public aliases and media. No new canonical store or ORM.

Observed sold/rented badges map to wire source_status=delisted with source_status_reason=sold/rented. Canonical state maps to inactive, never an inferred completed transaction. Negotiable prices map to null; no invented zero. Unknown/contradictory status fails closed. Missing prices do not create public offers. Secondary data cannot revive terminal 28hse records. Explicit source lifecycle and absence have distinct history reasons.

Schema/parser compatibility remains server-owned. Bump Python parser version to python-v2.1 for the newly supported lifecycle contract; operator must approve policy parser change via the existing versioned policy procedure. Do not rewrite historical payloads or advance old baselines with a mismatched parser.

A dedicated daily workflow supports collect/shadow/apply and frozen replay. Scheduled apply is disabled unless an explicit repository enable variable and production policy are approved; never perform schema migration or alter policy from the scheduled job. Managed DB secret already exists by name; do not retrieve or expose its value. Collect before connecting to DB. Shared concurrency never cancels a running import. Use frozen payload bytes for bounded transient retries; never recrawl to retry import. Outcome-unknown must retain the same payload. Hard validation failures must stop.

Retain compressed restricted raw evidence for 7 days and separate compact request/receipt/baseline evidence for 90 days, pinning the latest applied full baseline and unresolved/replay-needed evidence independently of ordinary retention. No existing inventory or history deletion. GitHub artifact persistence may expire; it must not be the only authoritative database baseline. Daily job summary contains counts and references, not contact data. Failure signals use failed workflow status; do not send real messages.

Activation requires confirmed current production schema/policy/ownership, one controlled old MLS schedule handoff and runner live-access smoke test. Do not touch the unrelated CRM/WhatsApp drain schedules. If required production gates cannot be established, finish tested code/docs and state concrete missing prerequisites without claiming the automation active.
