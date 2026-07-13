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
| PENDING_REVIEW → APPROVED | Reviewer `approveRental` | KYC/payment verified; dates still held | lock approval evidence, audit, notification |
| PENDING_REVIEW → REJECTED | Reviewer `rejectRental` | non-empty reason; refund disposition recorded if funds verified | release or retain for refund workflow, audit |
| APPROVED → PREPARING | Operations `startPreparation` | fulfillment assignment present | audit |
| PREPARING → READY_FOR_HANDOVER | Operations `markReady` | BEFORE_RENT log has required images/note | notification, audit |
| READY_FOR_HANDOVER → ACTIVE | Operations `handoverRental` | handover acknowledgement; laptop reserved | laptop RENTED, start timestamp |
| ACTIVE → RETURN_PENDING | Customer or Operations `requestReturn` | return initiated | audit/notification |
| RETURN_PENDING → INSPECTION_PENDING | Operations `receiveReturn` | device physically received | receipt timestamp |
| INSPECTION_PENDING → REFUND_PENDING | Operations `finalizeInspection` | AFTER_RETURN log complete; fee decision recorded | create idempotent refund/fee obligations |
| REFUND_PENDING → COMPLETED | system/Operations `completeFinancialSettlement` | refund not required or completed; fees resolved | laptop AVAILABLE or MAINTENANCE, audit |

Terminal states: `COMPLETED`, `REJECTED`, `CANCELLED`, `EXPIRED`. Reopening requires an Owner-only compensating command defined by a future ADR; direct reversal is invalid.

Global invalid paths include skipping review, entering ACTIVE without before-rent evidence, completing without after-return evidence/financial disposition, changing laptop/date/price after approval, and a customer acting on another customer's rental.

## Payment

| From → To | Actor/command | Guard | Side effect |
|---|---|---|---|
| PENDING → SUBMITTED | Customer `submitPaymentEvidence` | authorized rental; valid upload intent/object | immutable submission record |
| SUBMITTED → VERIFIED | Reviewer `verifyPayment` | amount/type match server obligation; reason/reference present | rental review guard satisfied, audit |
| SUBMITTED → REJECTED | Reviewer `rejectPayment` | reason present | customer may resubmit as a new payment attempt |
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
| PENDING/FAILED → CANCELLED | Owner `cancelRefund` | reason + compensating disposition | audit |

## Condition workflow

`BEFORE_RENT` may be finalized only for `PREPARING`; one finalized log is required before `READY_FOR_HANDOVER`. `AFTER_RETURN` may be finalized only for `INSPECTION_PENDING`; one finalized log and fee disposition are required before `REFUND_PENDING`. Finalized logs and evidence are append-only; corrections create a superseding log linked to the prior version.
