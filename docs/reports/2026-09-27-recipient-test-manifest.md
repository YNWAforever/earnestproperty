# Designated colleague message test — pending manifest

Status on 2026-09-27: **not sent**. No designated colleague or verified endpoint was supplied. An existing account named `test` is not a substitute. No provider request, delivery receipt, or handset confirmation exists for this assignment.

Complete this manifest in the private staging operations record before any live send. Keep recipient phone, provider IDs, tokens and raw screenshots out of this repository and PR.

| Required field                                                                            | Current state                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Designated staff ID and colleague name                                                    | Missing                                |
| Active role, branch and verified identity                                                 | Staging check pending                  |
| Inbox mapping ID/version and destination-isolation evidence                               | Staging check pending                  |
| Staff phone endpoint ID/version and masked destination                                    | Missing verified endpoint              |
| Chosen transport and verified provider channel                                            | Missing choice/verification            |
| Approved template name, language, parameters and WOZTELL JSON when outside session window | Missing tenant-approved contract       |
| Dedicated test handset and tester                                                         | Missing                                |
| One current offering, placement and real tracking-link version                            | Staging provisioning pending           |
| One-time request ID and preview token                                                     | Generated only at explicit test submit |

After those fields are verified, use the dedicated handset to open that one link and send its original prefilled EPWA text. Record the same reference through open, signed inbound, enquiry, requested staff, confirmed assignment, Inbox private note and staff WhatsApp attempt. Record provider `accepted`, signed `delivered`/`read` receipts and the colleague's own handset confirmation as separate fields; an absent receipt is `unknown`. Have the colleague open the work item and reply to the matching test enquiry. Repeat duplicate webhook and job-replay checks only with synthetic fixtures. No customer conversation or unverified colleague endpoint may be used for the test.

If browser policy blocks WhatsApp, log the restriction and let the designated tester use an allowed device. This leaves the website result separate from the device-policy gate.
