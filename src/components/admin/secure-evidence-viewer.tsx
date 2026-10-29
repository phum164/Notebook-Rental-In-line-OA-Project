"use client";

import { useEffect, useState } from "react";
import { AdminApi } from "./adapters/admin-api";
import type { EvidenceSummary } from "./adapters/types";
import { adminStyles as styles } from "./admin-shell";

export function SecureEvidenceViewer({ evidence, load = (id) => new AdminApi().signedRead(id) }: { evidence: EvidenceSummary; load?: (id: string) => Promise<{ readUrl: string; expiresAt: string }> }) {
  const [preview, setPreview] = useState<{ readUrl: string; expiresAt: string }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!preview) return;
    const remaining = previewLifetime(preview.expiresAt);
    const timer = window.setTimeout(() => setPreview(undefined), remaining);
    return () => window.clearTimeout(timer);
  }, [preview]);
  return <section className={styles.secure} aria-label={`${evidence.label} แบบจำกัดสิทธิ์`}>
    <strong>{evidence.label}</strong>
    <p className={styles.muted}>{evidence.maskedSubject} · ห้ามบันทึก/แชร์ข้อมูล</p>
    {preview ? <div role="status">
      {/* Dynamic private URLs cannot use next/image host allowlists. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.readUrl} alt={evidence.label} referrerPolicy="no-referrer" style={{ maxWidth: "100%" }} />
      <div>ลิงก์ชั่วคราวจะถูกล้างอัตโนมัติ</div>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button className={styles.secondaryButton} type="button" onClick={() => { setError(undefined); void load(evidence.id).then(setPreview).catch(() => setError("เปิดหลักฐานไม่สำเร็จหรือไม่มีสิทธิ์")); }}>
      ขอสิทธิ์ดูชั่วคราว
    </button>
  </section>;
}

export function previewLifetime(expiresAt: string, now = Date.now()): number { return Math.max(0, Math.min(60_000, Date.parse(expiresAt) - now)); }
