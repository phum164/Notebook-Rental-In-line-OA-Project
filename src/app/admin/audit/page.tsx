import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";

export default async function AuditPage() {
  const events = await mockAdminAdapter.listAudit();
  return <>
    <PageHeading eyebrow="Append-only history" title="ประวัติการทำงาน">แสดง projection ที่ redact แล้ว ไม่แสดง token, signed URL, object key หรือ PII</PageHeading>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>เวลา UTC</th><th>Action</th><th>เป้าหมาย</th><th>ผู้ดำเนินการ</th><th>เหตุผล</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.occurredAt}</td><td><strong>{event.action}</strong></td><td>{event.target}</td><td>{event.actorLabel}</td><td>{event.reason}</td></tr>)}</tbody></table></div>
  </>;
}
