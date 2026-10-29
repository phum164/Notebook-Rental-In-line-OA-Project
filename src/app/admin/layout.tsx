import type { ReactNode } from "react";
import { AdminGate } from "@/components/admin/admin-gate";

export default function AdminLayout({ children }: { children: ReactNode }) { return <AdminGate>{children}</AdminGate>; }
