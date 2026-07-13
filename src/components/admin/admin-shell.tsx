"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AdminContext } from "./adapters/types";
import { visibleRoutes, type AdminRoute } from "./policy";
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

export function AdminShell({ context, children }: { context: AdminContext; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <div className={styles.page}>{children}</div>;
  return <div className={styles.page}><div className={styles.shell}>
    <aside className={styles.sidebar} aria-label="เมนูผู้ดูแลระบบ">
      <div className={styles.brand}>NotebookRental</div>
      <div className={styles.mutedLight}>SECURE OPERATIONS</div>
      <nav className={styles.nav}>{visibleRoutes(context.role).map((route) => <Link key={route} href={route}>{labels[route]}</Link>)}</nav>
    </aside>
    <div className={styles.main}>
      <header className={styles.topbar}>
        <div><strong>{context.displayName}</strong><div className={styles.muted}>สิทธิ์จาก session ฝั่ง server · MFA ยืนยันแล้ว</div></div>
        <Link className={styles.secondaryButton} href="/admin/login?reason=session-expired">ออกจากระบบ</Link>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  </div></div>;
}

export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <><div className={styles.eyebrow}>{eyebrow}</div><h1 className={styles.title}>{title}</h1>{children ? <p className={styles.subtitle}>{children}</p> : null}</>;
}

export { styles as adminStyles };
