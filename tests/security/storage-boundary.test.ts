import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storageMigration = readFileSync("supabase/migrations/202607130002_rls_and_storage.sql", "utf8");
const rpcMigration = readFileSync("supabase/migrations/202608300003_cr_a02_01_rpc_boundary.sql", "utf8");
const adapter = readFileSync("src/services/supabase-api-operations.ts", "utf8");

describe("sensitive storage boundary", () => {
  it("keeps evidence buckets private and scanner/read access narrowly scoped", () => {
    for (const bucket of ["kyc-private", "payments-private", "conditions-private", "quarantine-private"]) {
      expect(storageMigration).toMatch(new RegExp(`\\('${bucket}', '${bucket}', false,`));
    }
    expect(rpcMigration).toContain("storage_scanner_exact_pending_read");
    expect(rpcMigration).toContain("public.can_scan_storage_object(storage.objects.bucket_id, storage.objects.name)");
    expect(adapter).toContain('throw new OperationUnavailable("An approved production malware scanner is required")');
    expect(adapter).toContain("{ expiresIn: 60 }");
  });
});
