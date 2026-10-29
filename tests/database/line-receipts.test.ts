import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202610260004_line_receipt_rpc.sql", "utf8");

describe("LINE receipt RPC boundary", () => {
  it("keeps the ledger metadata-only, default-deny and scoped", () => {
    const table = sql.slice(sql.indexOf("create table public.line_webhook_receipts"), sql.indexOf("create index line_webhook_receipts_pending_idx"));
    expect(table).not.toMatch(/raw_body|message_text|profile|destination|access_token/);
    expect(sql).toContain("alter table public.line_webhook_receipts force row level security");
    for (const role of ["app_line_webhook_ingress", "app_line_webhook_worker"]) {
      expect(sql).toContain(`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    }
    expect(sql).toContain("'line:webhook:persist',60");
    expect(sql).toContain("'line:webhook:process',300");
    expect(sql).not.toMatch(/grant[\s\S]{0,80}service_role/i);
  });

  it("defines fenced reclaim/dead-letter and the additive recipient projection", () => {
    expect(sql).toContain("for update skip locked limit p_limit");
    expect(sql).toContain("lease_token = gen_random_uuid()");
    expect(sql).toContain("lease_token = p_lease_token");
    expect(sql).toContain("LEASE_ATTEMPTS_EXHAUSTED");
    expect(sql).toContain("recipient_line_user_id");
    expect(sql).toContain("c.id = updated.recipient_customer_id and c.disabled_at is null");
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });
});
