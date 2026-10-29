import type { RentalCommand } from "./adapters/types";
import { adminStyles as styles } from "./admin-shell";

const labels: Record<string, string> = {
  approve: "อนุมัติ", reject: "ปฏิเสธ", "start-preparation": "เริ่มเตรียมเครื่อง", "mark-ready": "พร้อมส่งมอบ",
  handover: "ส่งมอบ", "request-return": "เริ่มรับคืนเครื่อง", "receive-return": "รับเครื่องคืน", "finalize-inspection": "สรุปตรวจสภาพ", "complete-settlement": "ปิดยอดการเงิน",
};

export function CommandPanel({ commands, busy, onCommand }: { commands: readonly RentalCommand[]; busy?: boolean; onCommand: (command: RentalCommand) => void }) {
  return <section className={styles.card}>
    <h2>ดำเนินการกับรายการ</h2>
    {commands.length ? <div className={styles.actions}>{commands.map((command) => <button className={styles.button} disabled={busy} type="button" key={command} onClick={() => onCommand(command)}>{labels[command]}</button>)}</div> : <p className={styles.muted}>ไม่มีขั้นตอนที่ดำเนินการต่อได้ในสถานะนี้</p>}
  </section>;
}
