import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { AppError, notFound } from '../domain/errors.js';
import type { Merchant } from '../domain/merchant.js';
import type { Logger } from '../ports/system.js';
import type { MerchantService } from '../services/MerchantService.js';
import { idSchema } from './schemas.js';

/** `Authorization: Bearer cpk_...` → res.locals.merchant */
export const requireMerchant =
  (merchants: MerchantService): RequestHandler =>
  async (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (!match) throw new AppError(401, 'UNAUTHORIZED', 'Missing API key');
    const merchant = await merchants.authenticate(match[1]!);
    if (!merchant) throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
    res.locals.merchant = merchant;
    next();
  };

export const currentMerchant = (res: Response): Merchant => res.locals.merchant as Merchant;

export function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound('Invoice');
  return parsed.data;
}

export const limiter = (windowMs: number, limit: number): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } },
  });

export const notFoundHandler: RequestHandler = () => {
  throw new AppError(404, 'NOT_FOUND', 'Route not found');
};

export const errorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues[0]?.message ?? 'Invalid request',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (error?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
      return;
    }
    logger.error('unhandled error', { error: error instanceof Error ? error.stack : String(error) });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
