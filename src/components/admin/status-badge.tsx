import { adminStyles as styles } from "./admin-shell";

export function StatusBadge({ children, tone = "default" }: { children: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClass = tone === "success" ? styles.success : tone === "warning" ? styles.warning : tone === "danger" ? styles.danger : "";
  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>;
}
