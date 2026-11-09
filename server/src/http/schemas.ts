import { isAddress } from 'viem';
import { z } from 'zod';
import { AMOUNT_PATTERN } from '../domain/money.js';

const blankTo = <T>(value: T) => (v: unknown) => (typeof v === 'string' && v.trim() === '' ? value : v);

const httpUrl = z.url({ protocol: /^https?$/, error: 'Must be an http(s) URL' }).max(500);
const optionalUrl = z.preprocess(blankTo(undefined), httpUrl.optional());
const nullableUrl = z.preprocess(blankTo(null), httpUrl.nullish());
const evmAddress = z.string().trim().refine((v) => isAddress(v), 'Invalid EVM address');
const optionalText = (max: number) => z.preprocess(blankTo(undefined), z.string().trim().max(max).optional());

export const registerMerchantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  payoutAddress: evmAddress,
  webhookUrl: nullableUrl.transform((v) => v ?? null),
});

export const updateMerchantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    payoutAddress: evmAddress.optional(),
    webhookUrl: nullableUrl,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

export const createInvoiceSchema = z.object({
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(AMOUNT_PATTERN, 'Use a positive amount')),
  chainId: z.coerce.number().int().optional(),
  description: optionalText(200),
  orderId: optionalText(100),
  redirectUrl: optionalUrl,
  expiresInMinutes: z.coerce.number().int().min(5).max(1440).optional(),
  payTo: z.preprocess(blankTo(undefined), evmAddress.optional()),
});

export const submitPaymentSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash'),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const idSchema = z.uuid();
