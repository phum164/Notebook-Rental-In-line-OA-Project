import type { AdminRole, Money, RentalStatus } from "@/types/domain";

export type RentalCommand =
  | "approve"
  | "reject"
  | "start-preparation"
  | "mark-ready"
  | "handover"
  | "request-return"
  | "receive-return"
  | "finalize-inspection"
  | "complete-settlement";

export type RentalGuards = {
  kycVerified?: boolean;
  paymentVerified?: boolean;
  refundDispositionRecorded?: boolean;
  fulfillmentAssigned?: boolean;
  beforeInspectionComplete?: boolean;
  handoverAcknowledged?: boolean;
  laptopReserved?: boolean;
  deviceReceived?: boolean;
  afterInspectionComplete?: boolean;
  feeDispositionRecorded?: boolean;
  financialSettlementComplete?: boolean;
  reason?: string;
};

export class DomainConflict extends Error {
  constructor(
    readonly code: "CONFLICT" | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
  }
}

const transitions: Record<RentalCommand, { from: RentalStatus; to: RentalStatus }> = {
  approve: { from: "PENDING_REVIEW", to: "APPROVED" },
  reject: { from: "PENDING_REVIEW", to: "REJECTED" },
  "start-preparation": { from: "APPROVED", to: "PREPARING" },
  "mark-ready": { from: "PREPARING", to: "READY_FOR_HANDOVER" },
  handover: { from: "READY_FOR_HANDOVER", to: "ACTIVE" },
  "request-return": { from: "ACTIVE", to: "RETURN_PENDING" },
  "receive-return": { from: "RETURN_PENDING", to: "INSPECTION_PENDING" },
  "finalize-inspection": { from: "INSPECTION_PENDING", to: "REFUND_PENDING" },
  "complete-settlement": { from: "REFUND_PENDING", to: "COMPLETED" },
};

const requiredRoles: Record<RentalCommand, readonly AdminRole[]> = {
  approve: ["OWNER", "REVIEWER"],
  reject: ["OWNER", "REVIEWER"],
  "start-preparation": ["OWNER", "OPERATIONS"],
  "mark-ready": ["OWNER", "OPERATIONS"],
  handover: ["OWNER", "OPERATIONS"],
  "request-return": ["OWNER", "OPERATIONS"],
  "receive-return": ["OWNER", "OPERATIONS"],
  "finalize-inspection": ["OWNER", "OPERATIONS"],
  "complete-settlement": ["OWNER", "OPERATIONS"],
};

export function inclusiveRentalDays(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  if (![startYear, startMonth, startDay, endYear, endMonth, endDay].every(Number.isInteger)) return 0;
  const start = Date.UTC(startYear!, startMonth! - 1, startDay!);
  const end = Date.UTC(endYear!, endMonth! - 1, endDay!);
  return end < start ? 0 : Math.round((end - start) / 86_400_000) + 1;
}

export function calculateQuote(
  dailyRateSatang: number,
  depositSatang: number,
  startDate: string,
  endDate: string,
): { rentalDays: number; dailyRate: Money; rentalSubtotal: Money; deposit: Money; totalDue: Money } {
  const rentalDays = inclusiveRentalDays(startDate, endDate);
  const subtotal = dailyRateSatang * rentalDays;
  const total = subtotal + depositSatang;
  if (
    rentalDays < 1 ||
    ![dailyRateSatang, depositSatang, subtotal, total].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999_999,
    )
  ) {
    throw new DomainConflict("CONFLICT", "Quote cannot be calculated safely");
  }
  const money = (amountSatang: number): Money => ({ amountSatang, currency: "THB" });
  return {
    rentalDays,
    dailyRate: money(dailyRateSatang),
    rentalSubtotal: money(subtotal),
    deposit: money(depositSatang),
    totalDue: money(total),
  };
}

export function canRunRentalCommand(command: RentalCommand, roles: readonly AdminRole[]): boolean {
  return requiredRoles[command].some((role) => roles.includes(role));
}

export function allowedRentalCommands(status: RentalStatus, roles: readonly AdminRole[]): RentalCommand[] {
  return (Object.keys(transitions) as RentalCommand[]).filter(
    (command) => transitions[command].from === status && canRunRentalCommand(command, roles),
  );
}

export function nextRentalStatus(
  current: RentalStatus,
  command: RentalCommand,
  guards: RentalGuards,
): RentalStatus {
  const transition = transitions[command];
  if (transition.from !== current) {
    throw new DomainConflict("INVALID_TRANSITION", `${command} is not allowed from ${current}`);
  }

  const valid =
    (command === "approve" && guards.kycVerified && guards.paymentVerified) ||
    (command === "reject" && Boolean(guards.reason?.trim()) && guards.paymentVerified !== true && guards.refundDispositionRecorded !== false) ||
    (command === "start-preparation" && guards.fulfillmentAssigned) ||
    (command === "mark-ready" && guards.beforeInspectionComplete) ||
    (command === "handover" && guards.handoverAcknowledged && guards.laptopReserved) ||
    (command === "request-return" && Boolean(guards.reason?.trim())) ||
    (command === "receive-return" && guards.deviceReceived) ||
    (command === "finalize-inspection" && guards.afterInspectionComplete && guards.feeDispositionRecorded && Boolean(guards.reason?.trim())) ||
    (command === "complete-settlement" && guards.financialSettlementComplete);

  if (!valid) throw new DomainConflict("INVALID_TRANSITION", `Guards are not satisfied for ${command}`);
  return transition.to;
}
