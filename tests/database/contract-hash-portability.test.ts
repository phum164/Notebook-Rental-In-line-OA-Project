import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const original = readFileSync("supabase/migrations/202608300003_cr_a02_01_rpc_boundary.sql", "utf8");
const migration = readFileSync("supabase/migrations/202610300007_contract_hash_portability.sql", "utf8");
const definition = /create(?: or replace)? function public\.publish_admin_contract\([\s\S]*?\n\$\$;/;

describe("contract SHA-256 portability (static; executable SQL is a separate gate)", () => {
  it("changes only the hash implementation and preserves the complete capability boundary", () => {
    const expected = original.match(definition)?.[0]
      .replace("create function", "create or replace function")
      .replace("digest(convert_to(p_content, 'UTF8'), 'sha256')", "pg_catalog.sha256(convert_to(p_content, 'UTF8'))");
    expect(expected).toBeTruthy();
    expect(migration.match(definition)?.[0]).toBe(expected);
    expect(migration).not.toMatch(/\b(?:grant|revoke|alter extension|create extension|execute)\b/i);
    expect(migration.trimEnd()).toMatch(/commit;$/);
  });
});
