import { AdminPageClient } from "@/components/admin/admin-page-client";

export default async function RentalDetailPage({ params }: { params: Promise<{ rentalId: string }> }) {
  const { rentalId } = await params;
  return <AdminPageClient kind="detail" rentalId={rentalId} />;
}
