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
