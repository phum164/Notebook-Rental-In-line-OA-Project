# SRD Traceability Baseline

| SRD use case | Component/routes | API operations | Primary entities | Test owner |
|---|---|---|---|---|
| Browse laptops/spec/price | Customer catalog/detail | `GET /laptops`, `GET /laptops/{id}` | laptops, laptop_images | A03 unit; A06 E2E |
| Calculate rental | Customer date/quote | `POST /quotes` | laptops, rentals/holds | A02 unit; A06 money/date |
| Booking + KYC | Booking wizard/upload | `POST /rentals`, upload intents | customers, rentals, evidence_objects | A02/A03; A06 auth/upload |
| Contract agreement | Contract step | `GET /contracts/current`, `POST /rentals/{id}/contract-acceptance` | contract_versions, contract_acceptances | A02/A03; A06 evidence |
| QR/slip payment | Payment step | `GET /payment-settings`, upload intent, `POST /rentals/{id}/payments` | payments, evidence_objects | A02/A03; A06 retry/privacy |
| Rental tracking/contact | Customer timeline | `GET /rentals/{id}`, LINE deep link | rentals, status_history | A03; A06 IDOR |
| Inventory management | Admin inventory | `/admin/laptops*` | laptops, laptop_images, audit_events | A02/A04; A06 RBAC |
| KYC/slip/order review | Admin queue/detail | admin review commands, signed reads | rentals, payments, evidence_objects | A02/A04/A05; A06 negative |
| Before/after condition | Admin inspection | inspection upload/commands | condition_logs, evidence_objects | A02/A04; A06 transition |
| Deposit refund/fees | Admin return workflow | fee and refund commands | payments, refunds, outbox | A02/A04; A06 idempotency |
| Settings/contracts/QR/messages | Admin settings | settings/contract commands | system_settings, contract_versions | A02/A04; A06 RBAC/audit |
| LINE notifications | Outbox worker/webhook | webhook + notification internal flow | outbox_events, webhook_receipts | A05; A06 signature/retry |

The detailed QA matrix is owned by A06 in Wave 1 and must retain every row above.
