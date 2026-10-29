"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminApi, AdminApiError } from "./adapters/admin-api";
import { adminStyles as styles } from "./admin-shell";

export function AdminMfaForm() {
  const api = useMemo(() => new AdminApi(), []);
  const router = useRouter();
  const [challenge, setChallenge] = useState<{ challengeId: string; expiresAt: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [restart, setRestart] = useState(false);
  async function start() {
    setBusy(true); setMessage(undefined);
    try { setChallenge(await api.startMfaChallenge()); }
    catch { setRestart(true); setMessage("เริ่มยืนยันตัวตนไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่"); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!challenge || !/^\d{6}$/.test(code)) return;
    setBusy(true); setMessage(undefined);
    try {
      await api.verifyMfa(challenge.challengeId, code);
      setCode(""); router.replace("/admin"); router.refresh();
    } catch (error) {
      setCode(""); setRestart(true); setChallenge(undefined);
      setMessage(error instanceof AdminApiError && error.code === "RATE_LIMITED" ? "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วเข้าสู่ระบบใหม่" : "รหัสไม่ถูกต้องหรือหมดเวลา กรุณาเข้าสู่ระบบใหม่");
    } finally { setBusy(false); }
  }
  return <div aria-busy={busy}>
    <p>เปิดแอปยืนยันตัวตนที่ลงทะเบียนไว้ แล้วกรอกรหัส 6 หลักเพื่อเข้าหลังบ้าน</p>
    {message ? <p className={styles.error} role="alert">{message}</p> : null}
    {restart ? <a className={styles.button} href="/api/v1/admin/auth/login">เข้าสู่ระบบใหม่</a> : challenge ? <form onSubmit={(event) => { event.preventDefault(); void verify(); }}>
      <div className={styles.field}><label htmlFor="admin-totp">รหัสจากแอปยืนยันตัวตน<input id="admin-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required /></label></div>
      <button className={styles.button} disabled={busy || !/^\d{6}$/.test(code)} type="submit">ยืนยันและเข้าหลังบ้าน</button>
    </form> : <button className={styles.button} type="button" disabled={busy} onClick={() => void start()}>เริ่มยืนยันสองขั้นตอน</button>}
  </div>;
}
