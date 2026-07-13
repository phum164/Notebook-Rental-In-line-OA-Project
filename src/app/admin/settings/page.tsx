import { PageHeading, adminStyles as styles } from "@/components/admin/admin-shell";

export default function SettingsPage() {
  return <>
    <PageHeading eyebrow="Owner only" title="ตั้งค่าระบบ">ค่าลับไม่อยู่ใน settings response; การเปลี่ยนค่าต้อง recent MFA, If-Match และ audit</PageHeading>
    <div className={styles.grid2}>
      <section className={styles.card}><h2>ข้อความและการชำระเงิน</h2><div className={styles.field}><label htmlFor="setting">ประเภท</label><select id="setting"><option>PAYMENT_INSTRUCTIONS</option><option>CONTACT_LINE_URL</option><option>AUTO_REPLY_TEXT</option></select></div><div className={styles.field}><label htmlFor="value">ค่าใหม่</label><textarea id="value" maxLength={5000} rows={5} /></div><div className={styles.field}><label htmlFor="setting-reason">เหตุผลการเปลี่ยนแปลง</label><input id="setting-reason" maxLength={500} /></div><button className={styles.button} type="button">บันทึก mock</button></section>
      <section className={styles.card}><h2>สัญญาเช่า</h2><p>เมื่อ publish ต้องสร้าง immutable version, snapshot และ SHA-256 hash ใหม่</p><button className={styles.secondaryButton} type="button">เตรียม draft version</button><p className={styles.muted}>Contract/Legal approval เป็น production gate</p></section>
    </div>
  </>;
}
