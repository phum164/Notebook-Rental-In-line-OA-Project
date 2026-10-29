"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AdminApi, AdminApiError } from "./adapters/admin-api";
import type { AdminContext } from "./adapters/types";
import { AdminShell, adminStyles as styles } from "./admin-shell";
import { routesForPermissions, type AdminRoute } from "./policy";

export function AdminGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const api = useMemo(() => new AdminApi(), []);
  const [context, setContext] = useState<AdminContext | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (pathname === "/admin/login") return;
    void api.getContext().then((value) => { setContext(value); setDenied(false); }).catch((error) => setDenied(error instanceof AdminApiError && ["AUTH_REQUIRED", "FORBIDDEN"].includes(error.code)));
  }, [api, pathname]);
  if (pathname === "/admin/login") return <div className={styles.page}>{children}</div>;
  if (denied) return <div className={styles.page}><section className={`${styles.card} ${styles.login}`}><h1>ไม่มีสิทธิ์เข้าหลังบ้าน</h1><p>กรุณาเข้าสู่ระบบผู้ดูแลและยืนยัน MFA</p><Link className={styles.button} href="/admin/login?reason=session-expired">ไปหน้าเข้าสู่ระบบ</Link></section></div>;
  if (!context) return <div className={styles.page}><p role="status">กำลังตรวจสอบ session ผู้ดูแล…</p></div>;
  const route = (["/admin/inventory", "/admin/rentals", "/admin/inspections", "/admin/finance", "/admin/settings", "/admin/audit"] as const).find((item) => pathname.startsWith(item)) ?? "/admin";
  if (!routesForPermissions(context.permissions).includes(route as AdminRoute)) return <div className={styles.page}><section className={`${styles.card} ${styles.login}`}><h1>ไม่มีสิทธิ์เปิดหน้านี้</h1><Link className={styles.button} href="/admin">กลับหน้าหลัก</Link></section></div>;
  return <AdminShell context={context}>{children}</AdminShell>;
}
