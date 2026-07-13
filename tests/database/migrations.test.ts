import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync("supabase/migrations/202607130001_foundation.sql", "utf8");
const policies = readFileSync("supabase/migrations/202607130002_rls_and_storage.sql", "utf8");
const seed = readFileSync("supabase/seed.sql", "utf8");

describe("database migration invariants", () => {
  it("uses integer satang and inclusive date overlap enforcement", () => {
    expect(foundation).toContain("create domain public.money_satang as bigint");
    expect(foundation).toContain("daterange(new.start_date, new.end_date, '[]')");
    expect(foundation).toContain("exclude using gist");
  });

  it("keeps sensitive storage private and intent-bound", () => {
    for (const bucket of ["kyc-private", "payments-private", "conditions-private", "quarantine-private"]) {
      expect(policies).toContain(`('${bucket}', '${bucket}', false`);
    }
    expect(policies).toContain("i.consumed_at is null");
    expect(policies).toContain("i.expires_at > statement_timestamp()");
    expect(policies).toContain("create function public.can_insert_storage_object(candidate_bucket text, candidate_name text)");
    expect(policies).toContain("security definer set search_path = public, pg_temp");
    expect(policies).toContain("public.can_insert_storage_object(storage.objects.bucket_id, storage.objects.name)");
    expect(policies).not.toContain("join public.upload_intents i on i.evidence_id = e.id\n+    where e.bucket_id = storage.objects.bucket_id");
    expect(foundation).toContain("create function public.enforce_evidence_limits()");
    expect(foundation).toContain("evidence_objects_finalized_immutable");
    expect(foundation).toContain("payments_verified_immutable");
  });

  it("validates customer JWT context and separates admin identity", () => {
    expect(policies).toContain("claims ->> 'principal_type' <> 'customer'");
    expect(policies).toContain("claims ->> 'iss' <> expected_issuer");
    expect(policies).toContain("not_before > extract(epoch from statement_timestamp()) + 30");
    expect(policies).toContain("expires_at - issued_at > 300");
    expect(policies).toContain("coalesce(auth.jwt() ->> 'principal_type', '') <> 'customer'");
    expect(policies).toContain("auth.jwt() ->> 'aal' = 'aal2'");
  });

  it("binds every sensitive evidence purpose to exactly one bucket", () => {
    expect(foundation).toContain("purpose = 'KYC_ID' and bucket_id = 'kyc-private'");
    expect(foundation).toContain("purpose = 'PAYMENT_SLIP' and bucket_id = 'payments-private'");
    expect(foundation).toContain("purpose in ('CONDITION_BEFORE', 'CONDITION_AFTER') and bucket_id = 'conditions-private'");
    expect(policies).toContain("storage_authorized_case_read");
  });

  it("uses synthetic, idempotent seed identifiers", () => {
    expect(seed).toContain("seed-line-subject-001");
    expect(seed).toContain("on conflict (id) do nothing");
    expect(seed).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
