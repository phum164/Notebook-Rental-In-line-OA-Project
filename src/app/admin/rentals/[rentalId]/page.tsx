import { notFound } from "next/navigation";
import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";
import { CommandPanel } from "@/components/admin/command-panel";
import { SecureEvidenceViewer } from "@/components/admin/secure-evidence-viewer";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function RentalDetailPage({ params }: { params: Promise<{ rentalId: string }> }) {
  const { rentalId } = await params;
  const [rental, context, evidence] = await Promise.all([mockAdminAdapter.getRental(rentalId), mockAdminAdapter.getContext(), mockAdminAdapter.listEvidence(rentalId)]);
  if (!rental) notFound();
  return <>
    <PageHeading eyebrow="Rental case" title={rental.reference}>ข้อมูลผู้เช่าถูก mask และ evidence ต้องขอ scoped read ทีละ object</PageHeading>
    <div className={styles.grid2}>
      <section className={styles.card}><h2>ภาพรวม</h2><p>{rental.customerLabel}</p><p>{rental.laptopAssetCode} · {rental.startDate} – {rental.endDate}</p><StatusBadge tone="warning">{rental.status}</StatusBadge><p className={styles.muted}>Version {rental.version} · เงินเก็บเป็น integer satang</p></section>
      <section className={styles.card}><h2>ผลตรวจ</h2><p>KYC: {rental.review.kyc}</p><p>Payment: {rental.review.payment}</p><div className={styles.field}><label htmlFor="reason">เหตุผล/บันทึก (ห้ามกรอก PII เกินจำเป็น)</label><textarea id="reason" maxLength={500} rows={3} /></div></section>
    </div><br />
    <div className={styles.grid2}>{evidence.length ? evidence.map((item) => <SecureEvidenceViewer key={item.id} evidence={item} />) : <p className={styles.muted}>role/case นี้ไม่มี evidence ที่เปิดดูได้</p>}</div><br />
    <CommandPanel role={context.role} status={rental.status} />
  </>;
}
