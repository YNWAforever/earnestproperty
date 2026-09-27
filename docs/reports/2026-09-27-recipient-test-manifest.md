# Designated colleague message test — pending manifest

Status on 2026-09-27: **not sent**. Willy Lai and a phone ending 3493 were supplied. The only staging staff row with that suffix is named test; the user explicitly confirmed that this is Willy's staff account. It has a verified Inbox private-note endpoint and the user confirmed no staff WhatsApp endpoint or approved template has been created. No provider request, delivery receipt, handset confirmation or one-time request ID exists for this assignment.

Complete this manifest in the private staging operations record before any live send. Keep recipient phone, provider IDs, tokens and raw screenshots out of this repository and PR.

| Required field                                                                            | Current state                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Designated staff ID and colleague name                                                    | Willy Lai; user-confirmed staff ID 72285986-c82c-46bd-98d9-c6b021d91b0d |
| Active role, branch and verified identity                                                 | User-confirmed account is active admin with auth identity on staging |
| Inbox mapping ID/version and destination-isolation evidence                               | Confirmed staff account has eligible Inbox mapping and private-note endpoint v2 |
| Staff phone endpoint ID/version and masked destination                                    | Phone suffix 3493; no staff_whatsapp endpoint for confirmed staff account |
| Chosen transport and verified provider channel                                            | Intended staff WhatsApp send remains blocked; Inbox note is a separate transport |
| Approved template name, language, parameters and WOZTELL JSON when outside session window | Missing tenant-approved contract       |
| Dedicated test handset and tester                                                         | Missing                                |
| One current offering, placement and real tracking-link version                            | Staging provisioning pending           |
| One-time request ID and preview token                                                     | Generated only at explicit test submit |

After those fields are verified, use the dedicated handset to open that one link and send its original prefilled EPWA text. Record the same reference through open, signed inbound, enquiry, requested staff, confirmed assignment, Inbox private note and staff WhatsApp attempt. Record provider `accepted`, signed `delivered`/`read` receipts and the colleague's own handset confirmation as separate fields; an absent receipt is `unknown`. Have the colleague open the work item and reply to the matching test enquiry. Repeat duplicate webhook and job-replay checks only with synthetic fixtures. No customer conversation or unverified colleague endpoint may be used for the test.

If browser policy blocks WhatsApp, log the restriction and let the designated tester use an allowed device. This leaves the website result separate from the device-policy gate.
