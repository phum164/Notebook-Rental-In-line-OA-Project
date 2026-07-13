import type { Money, RentalQuote, RentalStatus, Uuid } from "@/types/domain";

export type DemoScenario = "ready" | "loading" | "empty" | "error" | "expired" | "conflict" | "upload-failure";

export interface CustomerLaptop {
  id: Uuid;
  name: string;
  tagline: string;
  specs: readonly string[];
  dailyRate: Money;
  deposit: Money;
}

export interface CustomerRental {
  id: Uuid;
  laptopName: string;
  startDate: string;
  endDate: string;
  status: RentalStatus;
  updatedAt: string;
}

export interface CustomerMockSnapshot {
  scenario: DemoScenario;
  laptops: readonly CustomerLaptop[];
  quote: RentalQuote | null;
  rental: CustomerRental | null;
  message: string | null;
}

const SATANG_PER_BAHT = 100;

export const MOCK_LAPTOPS: readonly CustomerLaptop[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "ThinkPad X1 Carbon",
    tagline: "เบา ทน พร้อมทำงานทุกที่",
    specs: ["Intel Core i7", "RAM 16 GB", "SSD 512 GB", "14\" FHD"],
    dailyRate: { amountSatang: 35_000, currency: "THB" },
    deposit: { amountSatang: 300_000, currency: "THB" },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "MacBook Air M2",
    tagline: "ลื่นไหล แบตอึด สำหรับงานสร้างสรรค์",
    specs: ["Apple M2", "RAM 8 GB", "SSD 256 GB", "13.6\" Liquid Retina"],
    dailyRate: { amountSatang: 45_000, currency: "THB" },
    deposit: { amountSatang: 500_000, currency: "THB" },
  },
];

function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00+07:00`);
  const end = Date.parse(`${endDate}T00:00:00+07:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function makeMockQuote(laptop: CustomerLaptop, startDate: string, endDate: string): RentalQuote | null {
  const rentalDays = inclusiveDays(startDate, endDate);
  if (rentalDays < 1) return null;
  const subtotal = laptop.dailyRate.amountSatang * rentalDays;
  return {
    quoteId: "20000000-0000-4000-8000-000000000001",
    laptopId: laptop.id,
    dateRange: { startDate, endDate },
    rentalDays,
    dailyRate: laptop.dailyRate,
    rentalSubtotal: { amountSatang: subtotal, currency: "THB" },
    deposit: laptop.deposit,
    totalDue: { amountSatang: subtotal + laptop.deposit.amountSatang, currency: "THB" },
    expiresAt: "2026-07-13T10:30:00Z",
  };
}

export function getMockSnapshot(scenario: DemoScenario): CustomerMockSnapshot {
  const quote = makeMockQuote(MOCK_LAPTOPS[0]!, "2026-07-20", "2026-07-22");
  const base: CustomerMockSnapshot = {
    scenario,
    laptops: MOCK_LAPTOPS,
    quote,
    rental: {
      id: "30000000-0000-4000-8000-000000000001",
      laptopName: MOCK_LAPTOPS[0]!.name,
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      status: "PENDING_REVIEW",
      updatedAt: "2026-07-13T10:05:00Z",
    },
    message: null,
  };
  if (scenario === "loading") return { ...base, laptops: [], quote: null, rental: null };
  if (scenario === "empty") return { ...base, laptops: [], quote: null, rental: null, message: "ยังไม่มีเครื่องว่างในช่วงวันที่เลือก" };
  if (scenario === "error") return { ...base, laptops: [], quote: null, rental: null, message: "โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง" };
  if (scenario === "expired") return { ...base, quote: null, rental: null, message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบผ่าน LINE อีกครั้ง" };
  if (scenario === "conflict") return { ...base, quote: null, message: "เครื่องนี้เพิ่งถูกจอง กรุณาเลือกวันหรือเครื่องอื่น" };
  if (scenario === "upload-failure") return { ...base, message: "อัปโหลดไม่สำเร็จ ไฟล์ยังไม่ถูกส่ง กรุณาลองอีกครั้ง" };
  return base;
}

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(money.amountSatang / SATANG_PER_BAHT);
}

export function formatBangkokDateTime(utcInstant: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(utcInstant));
}

export interface UploadValidation { valid: boolean; reason?: string }

export function validatePrivateImage(file: Pick<File, "type" | "size">): UploadValidation {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { valid: false, reason: "รองรับเฉพาะ JPG, PNG หรือ WebP" };
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { valid: false, reason: "ไฟล์ต้องมีขนาดไม่เกิน 10 MB" };
  return { valid: true };
}

export function validateCustomer(name: string, phone: string): boolean {
  return name.trim().length > 0 && /^\+?[0-9]{9,15}$/.test(phone);
}
