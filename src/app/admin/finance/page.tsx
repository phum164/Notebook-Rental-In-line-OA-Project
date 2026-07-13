import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function FinancePage() {
  const rentals = await mockAdminAdapter.listRentals();
  return <>
    <PageHeading eyebrow="Financial disposition" title="ค่าธรรมเนียมและคืนเงิน">จำนวนเงินรับจาก server เป็น integer satang; สูตร fee ยังเป็น policy gate และ mock นี้ไม่คำนวณแทน</PageHeading>
    <div className={styles.grid2}>
      <section className={styles.card}><h2>บันทึกรายการแบบ itemized</h2><div className={styles.field}><label htmlFor="amount">จำนวน (สตางค์)</label><input id="amount" type="number" min="0" step="1" /></div><div className={styles.field}><label htmlFor="reason">เหตุผล</label><textarea id="reason" maxLength={500} rows={3} /></div><button className={styles.button} type="button">เตรียม refund mock</button><p className={styles.muted}>ต้อง recent MFA, idempotency key และ server ตรวจยอด obligation ก่อนทุกครั้ง</p></section>
      <section className={styles.card}><h2>คิวปิดยอด</h2>{rentals.filter((r) => ["INSPECTION_PENDING", "REFUND_PENDING"].includes(r.status)).map((r) => <div key={r.id}><strong>{r.reference}</strong> <StatusBadge tone="warning">{r.refundStatus}</StatusBadge><p className={styles.muted}>Inspection: {r.afterInspectionComplete ? "พร้อม" : "ยังไม่ครบ"} · Fee disposition: {r.feeDispositionComplete ? "พร้อม" : "รอสรุป"}</p></div>)}</section>
    </div>
  </>;
}
