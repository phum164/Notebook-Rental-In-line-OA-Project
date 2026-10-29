import { adminStyles as styles } from "@/components/admin/admin-shell";
import { AdminMfaForm } from "@/components/admin/admin-mfa-form";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; step?: string }> }) {
  const { reason, step } = await searchParams;
  return <section className={`${styles.card} ${styles.login}`}>
    <div className={styles.eyebrow}>Admin access</div><h1>เข้าสู่ระบบผู้ดูแล</h1>
    {reason ? <div className={styles.error} role="alert">session หมดอายุหรือไม่ถูกต้อง กรุณายืนยันตัวตนและ MFA ใหม่</div> : null}
    {step === "mfa" ? <AdminMfaForm /> : <>
      <p>เข้าสู่ระบบด้วยบัญชีผู้ดูแลและยืนยันตัวตนสองขั้นตอน</p>
      <a className={styles.button} href="/api/v1/admin/auth/login">เข้าสู่ระบบผู้ดูแล</a>
      <p className={styles.muted}>ระบบจะพาไปยังผู้ให้บริการยืนยันตัวตนขององค์กร แล้วกลับมายังหลังบ้าน</p>
    </>}
  </section>;
}
