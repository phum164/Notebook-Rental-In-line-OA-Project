"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import type { AdminContext } from "./adapters/types";
import { useMemo } from "react";
import { AdminApi } from "./adapters/admin-api";
import { routesForPermissions, type AdminRoute } from "./policy";
import styles from "./admin-shell.module.css";

const labels: Record<AdminRoute, string> = {
  "/admin": "ภาพรวม",
  "/admin/inventory": "คลังเครื่อง",
  "/admin/rentals": "ตรวจรายการเช่า",
  "/admin/inspections": "ตรวจสภาพ",
  "/admin/finance": "ค่าธรรมเนียม/คืนเงิน",
  "/admin/settings": "ตั้งค่าระบบ",
  "/admin/audit": "ประวัติการทำงาน",
};
const AdminSessionContext = createContext<AdminContext | null>(null);
export function useAdminContext() { return useContext(AdminSessionContext); }

export function AdminShell({ context, children }: { context: AdminContext; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const api = useMemo(() => new AdminApi(), []);
  if (pathname === "/admin/login") return <div className={styles.page}>{children}</div>;
  return <AdminSessionContext.Provider value={context}><div className={styles.page}><div className={styles.shell}>
    <aside className={styles.sidebar} aria-label="เมนูผู้ดูแลระบบ">
      <div className={styles.brand}>NotebookRental</div>
      <div className={styles.mutedLight}>SECURE OPERATIONS</div>
      <nav className={styles.nav}>{routesForPermissions(context.permissions).map((route) => <Link key={route} href={route}>{labels[route]}</Link>)}</nav>
    </aside>
    <div className={styles.main}>
      <header className={styles.topbar}>
        <div><strong>ผู้ดูแล · {context.roles.join(", ")}</strong><div className={styles.muted}>สิทธิ์จาก server · MFA {context.mfaVerified ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน"}</div></div>
        <button className={styles.secondaryButton} type="button" onClick={() => void api.logout().finally(() => router.push("/admin/login"))}>ออกจากระบบ</button>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  </div></div></AdminSessionContext.Provider>;
}

export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <><div className={styles.eyebrow}>{eyebrow}</div><h1 className={styles.title}>{title}</h1>{children ? <p className={styles.subtitle}>{children}</p> : null}</>;
}

export { styles as adminStyles };
