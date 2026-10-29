# LINE worker deployment

`GET /api/internal/line` is a dynamic Node.js endpoint with a 60-second execution limit. A scheduler must send `Authorization: Bearer <CRON_SECRET>`; the secret must be at least 32 characters and is never a browser value. The endpoint returns aggregate counts only, with no-store responses and generic failures. No production schedule is installed by this change.

Each invocation claims at most three inbound receipt rows and finalizes them as IGNORED because the SRD has no subscribed inbound chat business handler. Database claims/completions are fenced. Outbound work is not even claimed unless `LINE_NOTIFICATIONS_ENABLED=true`, `LINE_CHANNEL_ACCESS_TOKEN` exists, and an approved policy parses successfully.

The server-only `LINE_NOTIFICATION_POLICY_JSON` schema is:

```json
{
  "approvalReference": "OWNER-OPS-APPROVAL-REFERENCE",
  "adminRecipientId": "<approved LINE user ID>",
  "events": {
    "PAYMENT_SUBMITTED": {
      "recipient": "ADMIN",
      "text": "<approved text; optional {rentalId} placeholder>"
    },
    "RENTAL_APPROVED": {
      "recipient": "CUSTOMER",
      "text": "<approved text>"
    }
  }
}
```

This is a schema example, not an approval or a usable recipient. The runtime accepts only PAYMENT_SUBMITTED and RENTAL_* names from the shared rental status enum, with text length at most 4000. ADMIN selects the one approved server-configured LINE user; CUSTOMER selects the exact recipient from the scoped outbox claim. No customer-table grants are used. An unapproved event makes no provider call. Only the rental UUID placeholder is supported, so templates cannot interpolate profile/payment/PII fields.

Keep recipient/template policy stable while retryable events exist. Drain or explicitly review the backlog before changing a policy: each outbox UUID remains the provider retry key, including uncertain timeout outcomes. LINE 409 with an accepted-request header converges successfully; expired database leases are reclaimed with a new fence. An HTTP success means provider acceptance, not that a blocked user read or received a message.

Before enabling the schedule, record D-13 approval, confirm environment/channel isolation, apply migrations001–005 and trusted scoped signing-key configuration, run receipt/outbox replay tests, and run one synthetic recipient smoke. Choose a frequency supported by the hosting plan and approved latency target; no hosting-plan purchase or schedule is assumed. Alert on WORKER_UNAVAILABLE, repeated failures, exhausted attempts and increasing pending age using aggregate/redacted telemetry. Never log request headers, cookies, provider bodies, recipient IDs or messages.

The worker does not purge evidence. Orphan/quarantine/retention deletion remains disabled until the approved scanner, retention/legal-hold policy and tested storage deletion boundary exist.
