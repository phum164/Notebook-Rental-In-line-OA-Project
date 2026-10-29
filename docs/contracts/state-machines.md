# State Machines v1

Status names are API/schema contract. Clients submit commands; they never submit an arbitrary target status.

## Laptop

| From → To | Actor/command | Guard | Side effect | Invalid examples |
|---|---|---|---|---|
| AVAILABLE → RESERVED | system `holdInventory` | unexpired qualifying rental; no overlapping hold | attach rental hold, audit | client sets RESERVED; overlap exists |
| RESERVED → AVAILABLE | system `releaseInventory` | hold expired/cancelled/rejected | clear hold, audit | release active rental |
| RESERVED → RENTED | Operations `handoverRental` | rental READY_FOR_HANDOVER; before inspection complete | rental ACTIVE, audit | missing inspection/payment |
| RENTED → AVAILABLE | system `completeReturn` | return inspection and financial disposition complete | release inventory | refund/fees unresolved |
| AVAILABLE → MAINTENANCE | Operations | no current/near-term conflicting hold | audit | currently rented |
| MAINTENANCE → AVAILABLE | Operations | maintenance cleared | audit | unresolved defect |
| AVAILABLE/MAINTENANCE → RETIRED | Owner `retireLaptop` | no active/held rental | soft-delete timestamp, audit | hard delete/history loss |

## Rental

| From → To | Actor/command | Guard | Side effect |
|---|---|---|---|
| DRAFT → PENDING_PAYMENT | Customer `createBooking` | verified session; quote valid; atomic availability hold; customer fields valid | price/date snapshot, hold expiry, audit |
| PENDING_PAYMENT → PENDING_REVIEW | Customer `submitPaymentEvidence` | KYC + contract acceptance + payment evidence present | queue review, outbox notification |
| PENDING_PAYMENT → EXPIRED | system `expireHold` | hold expiry passed; no verified payment | release inventory, audit |
| PENDING_PAYMENT → CANCELLED | Customer `cancelRental` | cancellation policy permits; no verified payment | release inventory |
| PENDING_REVIEW → APPROVED | Reviewer `approveRental` | separate KYC and payment decisions are both `VERIFIED`; dates still held | lock approval evidence, audit, notification; never performs either review |
| PENDING_REVIEW → REJECTED | Reviewer `rejectRental` | non-empty reason; refund disposition recorded if funds verified | release or retain for refund workflow, audit |
| APPROVED → PREPARING | Operations `startPreparation` | fulfillment assignment present | audit |
| PREPARING → READY_FOR_HANDOVER | Operations `markReady` | BEFORE_RENT log has required images/note | notification, audit |
| READY_FOR_HANDOVER → ACTIVE | Operations `handoverRental` | handover acknowledgement; laptop reserved | laptop RENTED, start timestamp |
| ACTIVE → RETURN_PENDING | Customer or Operations `requestReturn` | return initiated | audit/notification |
| RETURN_PENDING → INSPECTION_PENDING | Operations `receiveReturn` | device physically received | receipt timestamp |
| INSPECTION_PENDING → REFUND_PENDING | Operations `finalizeInspection` | AFTER_RETURN log complete; fee decision recorded | create idempotent refund/fee obligations |
| REFUND_PENDING → COMPLETED | system/Operations `completeFinancialSettlement` | refund not required or completed; fees resolved | laptop AVAILABLE or MAINTENANCE, audit |

Terminal states: `COMPLETED`, `REJECTED`, `CANCELLED`, `EXPIRED`. Reopening requires an Owner-only compensating command defined by a future ADR; direct reversal is invalid.

The admin HTTP command for initiating return is `request-return` (Owner/Operations, ACTIVE, version and reason required). Final inspection atomically freezes the itemized fee disposition and creates one exact refund obligation, including NOT_REQUIRED for zero. Settlement requires that disposition and its completed/not-required refund; missing records never mean settled. Fees exceeding the deposit remain blocked until D-07 defines collection. A paid rental cannot be rejected without an implemented compensating refund.

Global invalid paths include skipping review, entering ACTIVE without before-rent evidence, completing without after-return evidence/financial disposition, changing laptop/date/price after approval, and a customer acting on another customer's rental.

## KYC review

| From → To | Actor/command | Guard | Side effect |
|---|---|---|---|
| NOT_SUBMITTED → PENDING | system `finalizeUpload` | customer owns rental; 1–2 purpose-bound KYC objects are `READY` | bind a new immutable KYC submission to the exact evidence IDs |
| PENDING → VERIFIED | Reviewer/Owner `verifyRentalKyc` | exact current evidence set is `READY`; rental version matches | append decision, reviewer/reason/time and audit |
| PENDING → REJECTED | Reviewer/Owner `rejectRentalKyc` | exact current evidence set is `READY`; non-empty reason; rental version matches | append decision and audit; allow a new submission |
| REJECTED → PENDING | system `finalizeUpload` | a new evidence set is finalized | create a new submission; retain the rejected submission |

KYC decisions and their evidence sets are append-only. `approveRental` returns `INVALID_TRANSITION` unless the current submission and a submitted payment attempt were independently verified.

## Payment

| From → To | Actor/command | Guard | Side effect |
|---|---|---|---|
| PENDING → SUBMITTED | Customer `submitPaymentEvidence` | authorized rental; valid upload intent/object | immutable submission record |
| SUBMITTED → VERIFIED | Reviewer/Owner `verifyRentalPayment` | rental/payment/version match; amount/type match server obligation; reason/reference present | rental review guard satisfied, audit |
| SUBMITTED → REJECTED | Reviewer/Owner `rejectRentalPayment` | rental/payment/version match; reason present | customer may resubmit as a new payment attempt |
| PENDING/SUBMITTED → VOIDED | system/Owner `voidPayment` | rental cancelled/duplicate; no settlement | audit |

Verified payments are immutable. Corrections use compensating payment/refund rows.

## Refund

| From → To | Actor/command | Guard | Side effect |
|---|---|---|---|
| NOT_REQUIRED → PENDING | Operations `requestRefund` | refundable balance > 0; inspection/fee decision complete | unique obligation + idempotency key |
| PENDING → PROCESSING | worker `claimRefund` | durable provider request not already sent | attempt record |
| PROCESSING → COMPLETED | worker/Operations `confirmRefund` | provider/reference evidence; amount matches obligation | settlement audit, notification |
| PROCESSING → FAILED | worker `recordRefundFailure` | retryable/permanent category recorded | alert/retry schedule |
| FAILED → PROCESSING | worker `retryRefund` | retry policy permits; same idempotency key | new attempt, no duplicate obligation |
| PENDING → COMPLETED | Owner/Operations `confirmRentalRefund` | recent MFA, exact obligation amount, bank transfer already performed, reference/reason and current version | one manual confirmation attempt, audit; no bank transfer is initiated |
| PENDING/FAILED → CANCELLED | Owner `cancelRefund` | reason + compensating disposition | audit |

## Condition workflow

`BEFORE_RENT` may be finalized only for `PREPARING`; one finalized log is required before `READY_FOR_HANDOVER`. `AFTER_RETURN` may be finalized only for `INSPECTION_PENDING`; one finalized log and fee disposition are required before `REFUND_PENDING`. Finalized logs and evidence are append-only; corrections create a superseding log linked to the prior version.
