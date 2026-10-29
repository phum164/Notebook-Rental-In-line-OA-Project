import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202610260005_critical_workflow_completion.sql", "utf8");

describe("critical workflow migration boundaries (static; executable SQL is a separate gate)", () => {
  it("pins every named capability and preserves execute-only access", () => {
    const definitions = sql.match(/create(?: or replace)? function public\./g) ?? [];
    expect(sql.match(/security definer set search_path = public, pg_temp/g)).toHaveLength(definitions.length);
    for (const name of ["get_rental_financial_summary", "confirm_rental_refund", "set_admin_laptop_status", "attach_admin_laptop_image", "get_customer_public_settings"]) {
      expect(sql).toContain(`function public.${name}(`);
    }
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)\b/i);
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });

  it("binds settlement to its frozen exact obligation and protects retry recovery", () => {
    expect(sql).toContain("rental_financial_dispositions_immutable");
    expect(sql).toContain("refunds_completed_provider_reference_key");
    expect(sql).toContain("refund_attempts_immutable");
    expect(sql).toContain("f.amount_satang=d.refundable_satang");
    expect(sql).toContain("fee_obligations_disposition_freeze");
    expect(sql).toContain("status='PROCESSING' and lease_expires_at<=statement_timestamp()");
    expect(sql).toContain("where attempts<5");
  });

  it("scopes resume data to current owned evidence and the accepted contract", () => {
    expect(sql).toContain("where id=p_rental_id and customer_id=actor");
    expect(sql).toContain("order by current_submission.created_at desc,current_submission.id desc limit 1");
    expect(sql).toContain("where d.submission_id=s.id and d.status='REJECTED'");
    expect(sql).toContain("not exists(select 1 from public.payments p where p.evidence_id=e.id)");
    expect(sql).toContain("join public.contract_versions c on c.id=a.contract_version_id");
    expect(sql).toContain("'acceptedContract',accepted");
  });
});
