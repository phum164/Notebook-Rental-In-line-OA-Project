import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";
import { StatusBadge } from "@/components/admin/status-badge";

export default async function InventoryPage() {
  const laptops = await mockAdminAdapter.listLaptops(true);
  return <>
    <PageHeading eyebrow="Inventory" title="คลังโน้ตบุ๊ก">แก้ไขด้วย optimistic version และ soft delete เท่านั้น รายการ retired ยังคงอยู่ในประวัติ</PageHeading>
    <div className={styles.actions}><button className={styles.button} type="button">เพิ่มเครื่อง (mock)</button><button className={styles.secondaryButton} type="button">รวมเครื่อง retired</button></div><br />
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>รหัส</th><th>รุ่น</th><th>สถานะ</th><th>ค่าเช่า/วัน</th><th>Version</th><th>การทำงาน</th></tr></thead><tbody>
      {laptops.map((laptop) => <tr key={laptop.id}><td><strong>{laptop.assetCode}</strong></td><td>{laptop.model}</td><td><StatusBadge tone={laptop.status === "AVAILABLE" ? "success" : laptop.status === "RETIRED" ? "danger" : "warning"}>{laptop.status}</StatusBadge></td><td>{(laptop.dailyRateSatang / 100).toLocaleString("th-TH", { style: "currency", currency: "THB" })}</td><td>{laptop.version}</td><td><button className={styles.secondaryButton} type="button">แก้ไข</button>{laptop.retiredAt ? <div className={styles.muted}>เก็บ history แล้ว</div> : null}</td></tr>)}
    </tbody></table></div>
  </>;
}
