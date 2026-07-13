import Link from "next/link";
import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";

export default async function AdminDashboardPage() {
  const [rentals, laptops] = await Promise.all([mockAdminAdapter.listRentals(), mockAdminAdapter.listLaptops()]);
  return <>
    <PageHeading eyebrow="Operations overview" title="ศูนย์ควบคุมงานเช่า">ข้อมูลตัวอย่างไม่ใช่ข้อมูลลูกค้าจริง และทุก mutation รอเชื่อม server-authoritative API ใน Wave ถัดไป</PageHeading>
    <div className={styles.grid}>
      <section className={styles.card}><div className={styles.muted}>รอตรวจเอกสาร</div><div className={styles.metric}>{rentals.filter((r) => r.status === "PENDING_REVIEW").length}</div><Link href="/admin/rentals">เปิดคิวตรวจ</Link></section>
      <section className={styles.card}><div className={styles.muted}>กำลังเตรียม/ใช้งาน</div><div className={styles.metric}>{rentals.filter((r) => ["PREPARING", "ACTIVE"].includes(r.status)).length}</div><Link href="/admin/inspections">ดูงานส่งมอบ</Link></section>
      <section className={styles.card}><div className={styles.muted}>เครื่องพร้อมเช่า</div><div className={styles.metric}>{laptops.filter((l) => l.status === "AVAILABLE").length}</div><Link href="/admin/inventory">ดูคลัง</Link></section>
    </div>
    <div className={styles.notice}><strong>Security gate:</strong> KYC, slip และ condition evidence ใช้ private object เท่านั้น ตัวดูใน mock ไม่เก็บ URL และล้าง preview handle อัตโนมัติ</div>
  </>;
}
