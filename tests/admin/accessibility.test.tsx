import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SecureEvidenceViewer } from "../../src/components/admin/secure-evidence-viewer";

describe("admin accessibility markup", () => {
  it("gives the restricted evidence region and its action accessible names", () => {
    const html = renderToStaticMarkup(<SecureEvidenceViewer evidence={{
      id: "opaque-evidence-01",
      purpose: "KYC",
      label: "เอกสารยืนยันตัวตน",
      maskedSubject: "เลขเอกสาร ••••4821",
    }} />);
    expect(html).toContain('aria-label="เอกสารยืนยันตัวตน แบบจำกัดสิทธิ์"');
    expect(html).toContain("ขอสิทธิ์ดูชั่วคราว");
    expect(html).toContain("เลขเอกสาร ••••4821");
    expect(html).not.toContain("http");
  });
});
