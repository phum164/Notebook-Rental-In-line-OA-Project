import Link from "next/link";
import { adminStyles as styles } from "@/components/admin/admin-shell";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <section className={`${styles.card} ${styles.login}`}>
    <div className={styles.eyebrow}>Admin access</div><h1>เข้าสู่ระบบผู้ดูแล</h1>
    {reason ? <div className={styles.error} role="alert">session หมดอายุหรือไม่ถูกต้อง กรุณายืนยันตัวตนและ MFA ใหม่</div> : null}
    <p>บัญชีผู้ดูแลแยกจาก session ลูกค้า และ staging/production ต้องผ่าน MFA ทุก role</p>
    <div className={styles.field}><label htmlFor="email">อีเมลผู้ดูแล</label><input id="email" type="email" autoComplete="username" /></div>
    <div className={styles.field}><label htmlFor="password">รหัสผ่าน</label><input id="password" type="password" autoComplete="current-password" /></div>
    <Link className={styles.button} href="/admin">เข้าสู่ mock dashboard</Link>
    <p className={styles.muted}>หน้านี้ไม่ส่ง credential ใน mock phase</p>
  </section>;
}
