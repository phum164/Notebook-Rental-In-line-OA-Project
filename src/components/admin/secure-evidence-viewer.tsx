"use client";

import { useEffect, useState } from "react";
import type { EvidenceSummary } from "./adapters/types";
import { adminStyles as styles } from "./admin-shell";

export function SecureEvidenceViewer({ evidence }: { evidence: EvidenceSummary }) {
  const [previewHandle, setPreviewHandle] = useState<string>();
  useEffect(() => {
    if (!previewHandle) return;
    const timer = window.setTimeout(() => setPreviewHandle(undefined), 60_000);
    return () => window.clearTimeout(timer);
  }, [previewHandle]);
  return <section className={styles.secure} aria-label={`${evidence.label} แบบจำกัดสิทธิ์`}>
    <strong>{evidence.label}</strong>
    <p className={styles.muted}>{evidence.maskedSubject} · ห้ามบันทึก/แชร์ข้อมูล</p>
    {previewHandle ? <div role="status">เปิดตัวอย่างแบบ opaque ชั่วคราวแล้ว · หมดอายุภายใน 60 วินาที ({previewHandle})</div> : null}
    <button className={styles.secondaryButton} type="button" onClick={() => setPreviewHandle(`preview-${evidence.id.slice(-8)}`)}>
      ขอสิทธิ์ดูชั่วคราว
    </button>
  </section>;
}
