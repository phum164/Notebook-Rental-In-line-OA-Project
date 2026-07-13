import Link from "next/link";
import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function RentalsPage() {
  const rentals = await mockAdminAdapter.listRentals();
  return <>
    <PageHeading eyebrow="Review queue" title="รายการเช่า">ผลลัพธ์ต้องถูก filter ตาม permission ฝั่ง server; UI ไม่ใช่ authorization boundary</PageHeading>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>รายการ</th><th>ลูกค้า</th><th>เครื่อง/ช่วงเช่า</th><th>สถานะ</th><th>ตรวจสอบ</th></tr></thead><tbody>
      {rentals.map((rental) => <tr key={rental.id}><td><Link href={`/admin/rentals/${rental.id}`}><strong>{rental.reference}</strong></Link></td><td>{rental.customerLabel}</td><td>{rental.laptopAssetCode}<div className={styles.muted}>{rental.startDate} – {rental.endDate}</div></td><td><StatusBadge tone={rental.status === "PENDING_REVIEW" ? "warning" : "default"}>{rental.status}</StatusBadge></td><td>KYC {rental.review.kyc}<br />Payment {rental.review.payment}</td></tr>)}
    </tbody></table></div>
  </>;
}
