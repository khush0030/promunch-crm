# Email follow-up and deal-stage findings

Status: analysis for the CRM redesign; proposed rules, no production changes.

## Coverage

Read all currently stored records in `deal_emails` (2,366), `deals` (371), `email_threads` (549), `outreach_drafts` (417), and `outreach_replies` (3). Deal-email records contain snippets, not complete messages; 454 match records in the full-body email table. Selected sample-related conversations were reviewed against those bodies. This is an analysis of the available CRM history, not a verified complete Gmail archive. Outbound deal records identify the mailbox as hello@promunch.in.

One message dated after 21 September 2026 was excluded from timing analysis. The three outreach replies explicitly identify themselves as simulated; none is evidence of a real prospect reply. Seven outreach drafts are marked sent/replied, insufficient for an independent cold-outreach timing study.

## Timing method and results

Candidate deal categories: corporate gifting/pantry, hotels/hospitality, retail, wholesale/distribution, and brand partnerships. Group by Gmail thread, sort by sent time, match each inbound reply to the latest preceding outbound message only when the inbound sender appears in that outbound recipient field. Exclude recognisable bounces, automatic replies, notification senders, and internal-domain inbound messages. No pairing across companies or unrelated Gmail threads. Categories are existing machine classifications and may contain errors.

This yields 87 matched reply intervals across 40 threads and 36 deal records:

| Elapsed calendar time | Observed replies received |
|---|---:|
| 1 day | 55 / 87 (63%) |
| 3 days | 72 / 87 (83%) |
| 5 days | 79 / 87 (91%) |
| 7 days | 82 / 87 (94%) |

Median observed response time: 18.3 hours. These are percentages of matched replies, NOT campaign reply rates. They include established conversations, repeated replies from the same companies, and replies after follow-ups. Silent recipients are not in the denominator. They cannot establish the causal benefit or optimal timing of a follow-up.

There are 87 consecutive-outbound gaps of at least one day in the filtered threads; median 8.32 days, 46 exceeding seven days. These are possible follow-ups, not a manually verified follow-up set. Filtering out automated/internal messages can connect outbound messages separated by such messages. Missing history and duplicate outbound copies further limit interpretation.

## Proposed follow-up policy

Use five calendar days as a provisional default for unanswered initial outreach, three days for an active commercial conversation after our response, and seven days where a buyer says they are reviewing internally without providing a date. Shift reminders falling outside working days to the next working day, with calendar configuration to confirm. These are initial policies informed by history, not proven optima.

An explicit promised date overrides defaults. A buyer question creates an action for our team immediately; do not wait three days to answer. Sample feedback timing starts from confirmed receipt, not our offer or an assumed shipping date: provisionally three days after receipt, allowing up to seven when the buyer requests evaluation time. Unknown delivery creates a delivery-check task. Missing address or undispatched samples create an internal action; only chase the buyer when information is owed by them.

Recommend and draft only. Each draft is reviewed individually and then batch-approved, per user preference. Recheck the latest conversation before sending; reply, rejection, unsubscribe, bounce, explicit deferral, and closed-deal states must suppress inappropriate follow-ups. Existing no-duplicate-send controls remain mandatory.

## Evidence of stage errors

- Genaxy (`00f5cc3d-1393-4969-aaec-85b4bd96ae04`): accepted sample evaluation, while the 20 August outbound asks for an address. Current stage is samples_sent; available evidence supports samples agreed, awaiting address.
- Aurobindo (`0d3f8ee2-b4e1-40b5-97ed-9bf29b4ecab6`): current samples_requested stage conflicts with delivery-failure messages and its own summary. Bounces do not qualify a deal.
- Aesthetic Box (`25d3b4c1-92ef-4273-9430-e7910b621f6b`): buyer explicitly requested samples and supplied an address on 14 September. This is qualifying interest. The 17 September outbound promises arrival in a few days; it does not by itself prove receipt.
- Gofig (`bf6b5026-58ad-4e9d-b284-0d3a77671da0`): August correspondence contains positive tasting feedback and requests for margins/MOQs. This is commercial interest. Earlier listing activity and a new gifting discussion illustrate why one company can have multiple opportunities; do not overwrite a previously won opportunity blindly.

## Proposed stage model

1. Interested: genuine buyer interest, including willingness to try; our own sample offer is insufficient.
2. Samples agreed: buyer asks for or accepts samples. Substatus: awaiting address / ready to dispatch.
3. Samples sent: dispatch evidence or explicit team confirmation. Substatus: in transit / received, awaiting feedback. Never infer sent from agreed, or delivered from sent.
4. Commercial discussion: buyer asks for pricing, margins, MOQ, or purchase terms; may occur before sampling.
5. Won: explicit agreed order/contract or confirmed business outcome; positive feedback alone is insufficient.

Keep lost/dormant outside the active default. Preserve supporting message, date, and explanation for automatic changes, with manual correction. Ambiguous evidence becomes a review suggestion. Do not create extra board columns for every sample substatus.

## Redesign implications

Deals default to a compact table, with board as an alternate view and an active last-60-days filter based on last meaningful email activity. Do not let bounces/test messages falsely refresh activity. Show company, stage, deal value when known, last interaction, next action and due date. Expand for evidence and history. Keep historical data searchable. Classification cleanup is necessary alongside visual cleanup; otherwise false sample stages continue to overload the screen.

Further validation: compare CRM coverage with the actual mailbox, verify outbound completeness, distinguish opportunities within companies, validate contact matching and stage classification, and measure future reply outcomes using real sent-message cohorts including nonresponders.
