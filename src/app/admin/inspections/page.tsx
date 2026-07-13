import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function InspectionsPage() {
  const inspections = await mockAdminAdapter.listInspections();
  return <>
    <PageHeading eyebrow="Condition evidence" title="ตรวจสภาพก่อนส่งและหลังคืน">log ที่ finalize แล้วแก้ทับไม่ได้ การแก้ไขต้องสร้างรายการใหม่ที่อ้างถึงรายการเดิม</PageHeading>
    <div className={styles.notice}>ก่อน READY_FOR_HANDOVER ต้องมี BEFORE_RENT ที่ครบถ้วน และก่อน REFUND_PENDING ต้องมี AFTER_RETURN พร้อม fee disposition</div>
    <div className={styles.grid2}>
      <section className={styles.card}><h2>สร้าง inspection mock</h2><div className={styles.field}><label htmlFor="stage">ขั้นตอน</label><select id="stage"><option>BEFORE_RENT</option><option>AFTER_RETURN</option></select></div><div className={styles.field}><label htmlFor="notes">บันทึกสภาพ (ห้ามใส่ PII)</label><textarea id="notes" maxLength={2000} rows={4} /></div><div className={styles.field}><label htmlFor="evidence">Opaque evidence IDs (1–12)</label><input id="evidence" placeholder="เลือกจาก private upload workflow" readOnly /></div><button className={styles.button} type="button">Finalize mock</button></section>
      <section className={styles.card}><h2>ประวัติ append-only</h2>{inspections.map((item) => <div key={item.id}><StatusBadge>{item.type}</StatusBadge> <strong>{item.rentalReference}</strong><p className={styles.muted}>{item.evidenceCount} หลักฐาน · {item.finalizedAt}</p></div>)}</section>
    </div>
  </>;
}
