import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redbook Rental",
  description: "เช่าโน้ตบุ๊กง่าย ๆ ผ่าน LINE",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b4232c",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Per-request CSP nonces must be attached during rendering, never reused in cached HTML.
  await connection();
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
