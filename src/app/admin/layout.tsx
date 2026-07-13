import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { mockAdminAdapter } from "@/components/admin/adapters/mock-admin";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await mockAdminAdapter.getContext();
  return <AdminShell context={context}>{children}</AdminShell>;
}
