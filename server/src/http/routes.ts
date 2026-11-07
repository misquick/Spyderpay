import { Router } from 'express';
import { AppError } from '../domain/errors.js';
import type { InvoiceService } from '../services/InvoiceService.js';
import type { MerchantService } from '../services/MerchantService.js';
import type { PaymentService } from '../services/PaymentService.js';
import type { Presenter } from '../services/presenter.js';
import { currentMerchant, limiter, parseId, requireMerchant } from './middleware.js';
import {
  createInvoiceSchema,
  listQuerySchema,
  registerMerchantSchema,
  submitPaymentSchema,
  updateMerchantSchema,
} from './schemas.js';

const MINUTE = 60_000;

/** Merchant account: registration and profile. */
export function merchantRoutes(merchants: MerchantService, presenter: Presenter, registrationOpen: boolean): Router {
  const router = Router();
  const auth = requireMerchant(merchants);

  router.post('/', limiter(60 * MINUTE, 20), async (req, res) => {
    if (!registrationOpen) throw new AppError(403, 'REGISTRATION_CLOSED', 'Registration is disabled on this server');
    const { merchant, apiKey } = await merchants.register(registerMerchantSchema.parse(req.body));
    res.status(201).json({ merchant: presenter.merchant(merchant), apiKey });
  });

  router.get('/me', auth, (_req, res) => {
    res.json({ merchant: presenter.merchant(currentMerchant(res)) });
  });

  router.patch('/me', auth, async (req, res) => {
    const merchant = await merchants.update(currentMerchant(res).id, updateMerchantSchema.parse(req.body));
    res.json({ merchant: presenter.merchant(merchant) });
  });

  return router;
}

/** Invoices, for the merchant (API key required). */
export function invoiceRoutes(merchants: MerchantService, invoices: InvoiceService, presenter: Presenter): Router {
  const router = Router();
  router.use(requireMerchant(merchants));

  router.post('/', async (req, res) => {
    const invoice = await invoices.create(currentMerchant(res), createInvoiceSchema.parse(req.body));
    res.status(201).json({ invoice: presenter.invoice(invoice) });
  });

  router.get('/', async (req, res) => {
    const { limit } = listQuerySchema.parse(req.query);
    const list = await invoices.list(currentMerchant(res), limit);
    res.json({ invoices: list.map((i) => presenter.invoice(i)) });
  });

  router.get('/:id', async (req, res) => {
    const invoice = await invoices.getForMerchant(currentMerchant(res), parseId(req.params.id));
    res.json({ invoice: presenter.invoice(invoice) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const invoice = await invoices.cancel(currentMerchant(res), parseId(req.params.id));
    res.json({ invoice: presenter.invoice(invoice) });
  });

  return router;
}

/** What the customer's payment page uses. No authentication — the invoice id is the secret. */
export function publicRoutes(invoices: InvoiceService, payments: PaymentService, presenter: Presenter): Router {
  const router = Router();

  router.get('/invoices/:id', async (req, res) => {
    const { invoice, merchant } = await invoices.getPublic(parseId(req.params.id));
    res.set('cache-control', 'no-store').json({ invoice: presenter.publicInvoice(invoice, merchant) });
  });

  router.post('/invoices/:id/payments', limiter(MINUTE, 30), async (req, res) => {
    const id = parseId(req.params.id);
    const { txHash } = submitPaymentSchema.parse(req.body);
    await payments.submitTransaction(id, txHash);
    const { invoice, merchant } = await invoices.getPublic(id);
    res.json({ invoice: presenter.publicInvoice(invoice, merchant) });
  });

  return router;
}
