import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202608300003_cr_a02_01_rpc_boundary.sql", "utf8");

const requiredFunctions = [
  "app_issue_line_bootstrap_nonce",
  "app_create_line_session",
  "app_resolve_session",
  "app_revoke_session",
  "create_rental_quote",
  "create_rental_from_quote",
  "accept_rental_contract",
  "create_upload_intent_record",
  "authorize_upload_scan",
  "can_scan_storage_object",
  "finalize_upload_intent_record",
  "submit_rental_payment",
  "get_admin_session",
  "verify_rental_kyc",
  "reject_rental_kyc",
  "verify_rental_payment",
  "reject_rental_payment",
  "create_admin_laptop",
  "update_admin_laptop",
  "retire_admin_laptop",
  "execute_rental_command",
  "create_rental_inspection",
  "create_rental_fee_obligation",
  "request_rental_refund",
  "authorize_evidence_read",
  "update_admin_setting",
  "publish_admin_contract",
  "claim_notification_outbox",
  "complete_notification_outbox",
] as const;

describe("CR-A02-01 RPC boundary migration", () => {
  it("installs every named atomic capability and commits the forward migration", () => {
    for (const name of requiredFunctions) {
      expect(sql).toContain(`function public.${name}(`);
    }
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });

  it("keeps session and worker roles execute-only and never grants service role", () => {
    expect(sql).toContain("create role app_session_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    expect(sql).toContain("create role app_upload_scanner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    expect(sql).toContain("revoke all on all tables in schema public from app_session_service, app_outbox_worker");
    expect(sql).toContain("revoke all on all sequences in schema public from app_session_service, app_outbox_worker");
    expect(sql).toContain("to app_session_service;");
    expect(sql).toContain("to app_outbox_worker;");
    expect(sql).toContain("to app_upload_scanner;");
    expect(sql).toContain("storage_scanner_exact_pending_read");
    expect(sql).not.toMatch(/grant[\s\S]{0,120}service_role/i);
  });

  it("pins security-definer paths and enforces identity, replay and overlap at the database boundary", () => {
    const definitions = sql.match(/create(?: or replace)? function public\./gi) ?? [];
    const pinned = sql.match(/security definer set search_path = public, pg_temp/gi) ?? [];
    expect(pinned.length).toBeGreaterThanOrEqual(definitions.length - 1);
    expect(sql).toContain("public._service_scope('session_service', 'app_session_service'");
    expect(sql).toContain("public._idempotency_start");
    expect(sql).toContain("exception when exclusion_violation then raise exception 'CONFLICT'");
    expect(sql).toContain("for update skip locked");
  });

  it("keeps review evidence append-only and approval separate from review", () => {
    expect(sql).toContain("create trigger kyc_decisions_immutable");
    expect(sql).toContain("payment.status <> 'SUBMITTED'");
    expect(sql).toContain("d.status = 'VERIFIED'");
    expect(sql).toContain("p.status = 'VERIFIED'");
    expect(sql).toContain("then raise exception 'INVALID_TRANSITION'");
  });
});
