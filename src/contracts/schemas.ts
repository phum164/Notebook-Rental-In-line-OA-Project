import { z } from "zod";

export const isoDateSchema = z.iso.date();
export const uuidSchema = z.uuid();
export const moneySatangSchema = z.int().nonnegative().max(999_999_999_99);

export const dateRangeSchema = z
  .object({ startDate: isoDateSchema, endDate: isoDateSchema })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const quoteRequestSchema = dateRangeSchema.extend({ laptopId: uuidSchema });

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const issuedLineBootstrapNonceSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const kycEvidenceIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(2)
  .refine((ids) => new Set(ids).size === ids.length, "evidenceIds must be unique");

export const verifyKycCommandSchema = z
  .object({
    evidenceIds: kycEvidenceIdsSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const rejectKycCommandSchema = z
  .object({
    evidenceIds: kycEvidenceIdsSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const verifyPaymentCommandSchema = z
  .object({
    providerReference: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const rejectPaymentCommandSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
