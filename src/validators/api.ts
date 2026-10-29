import { z } from "zod";

import {
  idempotencyKeySchema,
  moneySatangSchema,
  quoteRequestSchema,
  rejectKycCommandSchema,
  rejectPaymentCommandSchema,
  uuidSchema,
  verifyKycCommandSchema,
  verifyPaymentCommandSchema,
} from "../contracts/schemas";
import { RENTAL_STATUSES } from "../types/domain";

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const lineSessionSchema = strict({
  accessToken: z.string().min(20),
  nonce: z.string().min(16).max(128),
});

export const paginationSchema = strict({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const catalogQuerySchema = paginationSchema.extend({
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
}).superRefine(({ startDate, endDate }, context) => {
  if (Boolean(startDate) !== Boolean(endDate)) {
    context.addIssue({ code: "custom", message: "startDate and endDate must be supplied together" });
  } else if (startDate && endDate && startDate > endDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "endDate must be on or after startDate" });
  }
});

export const quoteSchema = quoteRequestSchema.strict();
export const createRentalSchema = strict({
  quoteId: uuidSchema,
  customer: strict({
    name: z.string().trim().min(1).max(120),
    phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  }),
});
export const contractAcceptanceSchema = strict({
  contractVersionId: uuidSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  accepted: z.literal(true),
});
export const paymentSubmissionSchema = strict({
  type: z.literal("RENT_AND_DEPOSIT"),
  evidenceId: uuidSchema,
});

export const uploadIntentSchema = strict({
  purpose: z.enum(["KYC_ID", "PAYMENT_SLIP", "CONDITION_BEFORE", "CONDITION_AFTER", "LAPTOP_PRODUCT"]),
  targetId: uuidSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(10_485_760),
});

export const adminRentalQuerySchema = paginationSchema.extend({
  status: z.enum(RENTAL_STATUSES).optional(),
});
export const adminLaptopQuerySchema = paginationSchema.extend({
  includeRetired: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
});
export const laptopMutationSchema = strict({
  name: z.string().trim().min(1).max(200),
  specs: z.record(z.string(), z.unknown()),
  dailyRateSatang: moneySatangSchema,
  depositSatang: moneySatangSchema,
});
export const laptopStatusSchema = strict({ status: z.enum(["AVAILABLE", "MAINTENANCE"]), reason: z.string().trim().min(1).max(500) });
export const laptopImageSchema = strict({ evidenceId: uuidSchema, altText: z.string().trim().max(200).optional() });
export const refundConfirmationSchema = strict({ amountSatang: moneySatangSchema, providerReference: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) });
export const adminMfaChallengeSchema = strict({});
export const adminMfaVerifySchema = strict({ challengeId: uuidSchema, code: z.string().regex(/^[0-9]{6}$/) });
export const rentalCommandSchema = strict({
  reason: z.string().trim().min(1).max(500).optional(),
  inspectionId: uuidSchema.optional(),
});
export const refundSchema = strict({
  amountSatang: moneySatangSchema,
  reason: z.string().trim().min(1).max(500),
});
export const inspectionSchema = strict({
  type: z.enum(["BEFORE_RENT", "AFTER_RETURN"]),
  evidenceIds: z.array(uuidSchema).min(1).max(12),
  notes: z.string().trim().min(1).max(2000),
});
export const feeSchema = strict({
  type: z.enum(["LATE_FEE", "DAMAGE_FEE"]),
  amountSatang: moneySatangSchema,
  reason: z.string().trim().min(1).max(500),
});
export const settingSchema = strict({
  key: z.enum(["PAYMENT_INSTRUCTIONS", "CONTACT_LINE_URL", "AUTO_REPLY_TEXT"]),
  value: z.string().max(5000),
}).superRefine(({ key, value }, context) => {
  try {
    if (key === "CONTACT_LINE_URL") {
      const url = new URL(value);
      if (value.length > 2048 || url.protocol !== "https:" || !["line.me", "lin.ee"].includes(url.hostname) || url.username || url.password || url.port) throw new Error("Invalid contact URL");
    }
    if (key === "PAYMENT_INSTRUCTIONS") {
      const payment = z.object({ qrImageUrl: z.url().max(2048), accountDisplayName: z.string().trim().min(1).max(200) }).strict().parse(JSON.parse(value));
      const url = new URL(payment.qrImageUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid payment image URL");
    }
  } catch { context.addIssue({ code: "custom", path: ["value"], message: "Setting value does not match its public contract" }); }
});
export const contractPublishSchema = strict({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(100_000),
  effectiveAt: z.iso.datetime({ offset: true }),
});
export const auditQuerySchema = paginationSchema.extend({
  targetType: z.string().max(80).optional(),
  targetId: uuidSchema.optional(),
});

export const pathUuidSchema = uuidSchema;
export {
  idempotencyKeySchema,
  rejectKycCommandSchema,
  rejectPaymentCommandSchema,
  verifyKycCommandSchema,
  verifyPaymentCommandSchema,
};
