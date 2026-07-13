import type { AdminRole, RentalStatus } from "@/types/domain";
import { allowedRentalCommands } from "./policy";
import { adminStyles as styles } from "./admin-shell";

const labels: Record<string, string> = {
  approve: "อนุมัติ", reject: "ปฏิเสธ", "start-preparation": "เริ่มเตรียมเครื่อง", "mark-ready": "พร้อมส่งมอบ",
  handover: "ส่งมอบ", "receive-return": "รับเครื่องคืน", "finalize-inspection": "สรุปตรวจสภาพ", "complete-settlement": "ปิดยอดการเงิน",
};

export function CommandPanel({ role, status }: { role: AdminRole; status: RentalStatus }) {
  const commands = allowedRentalCommands(role, status);
  return <section className={styles.card}>
    <h2>การดำเนินการตาม state machine</h2>
    {commands.length ? <div className={styles.actions}>{commands.map((command) => <button className={styles.button} type="button" key={command}>{labels[command]}</button>)}</div> : <p className={styles.muted}>ไม่มี command ที่ role และสถานะปัจจุบันอนุญาต</p>}
    <p className={styles.muted}>Mock เท่านั้น — API ต้องตรวจ role, state guard, If-Match, idempotency key และบันทึก actor/time/reason ซ้ำทุกครั้ง</p>
  </section>;
}
