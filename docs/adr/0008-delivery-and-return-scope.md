# ADR-0008: MVP delivery and return state scope

- Status: Provisional product assumption, expires 2026-08-15
- Date: 2026-07-13

The MVP represents operational delivery through `PREPARING`, `READY_FOR_HANDOVER`, `ACTIVE`, `RETURN_PENDING` and `INSPECTION_PENDING`. It records method (`PICKUP` or `DELIVERY`), recipient/contact/address snapshot when applicable, outbound/inbound tracking reference and relevant UTC event times. Address fields are private and minimized.

Carrier integration is out of scope for Wave 1; operations update events through guarded commands. Product Owner must approve mandatory address/tracking fields before schema/API production freeze.
