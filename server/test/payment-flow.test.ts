import { beforeEach, describe, expect, it } from 'vitest';
import { ChainRegistry } from '../src/config/chains.js';
import { AppError } from '../src/domain/errors.js';
import { NATIVE } from '../src/domain/invoice.js';
import { verifyWebhook } from '../src/domain/webhook.js';
import { silentLogger } from '../src/ports/system.js';
import { ConfirmationTracker } from '../src/services/ConfirmationTracker.js';
import { InvoiceService } from '../src/services/InvoiceService.js';
import { MerchantService } from '../src/services/MerchantService.js';
import { PaymentScanner } from '../src/services/PaymentScanner.js';
import { PaymentService } from '../src/services/PaymentService.js';
import { Presenter } from '../src/services/presenter.js';
import { WebhookDispatcher } from '../src/services/WebhookDispatcher.js';
import { WebhookPublisher } from '../src/services/WebhookPublisher.js';
import {
  FakeChain,
  FakeClock,
  MERCHANT_WALLET,
  memoryRepositories,
  RecordingSender,
  testChain,
  testChains,
  TOKEN,
} from './fakes.js';

function setup() {
  const clock = new FakeClock();
  // Block 1000 is "now"; one block every 2 s.
  const chain = new FakeChain(new Date(clock.now().getTime() - 1000 * 2000));
  const { repos, uow } = memoryRepositories();
  const presenter = new Presenter(testChains, 'https://pay.example');
  const publisher = new WebhookPublisher(presenter, clock);
  const merchants = new MerchantService(repos.merchants);
  const invoices = new InvoiceService(repos.invoices, repos.merchants, testChains, clock, 30);
  const payments = new PaymentService(repos.invoices, chain);
  const scanner = new PaymentScanner(testChain, chain, repos, uow, payments, publisher, silentLogger, {
    blockRange: 50,
    maxBatches: 10,
  });
  const tracker = new ConfirmationTracker(testChain, chain, repos, uow, publisher, clock, silentLogger);
  const sender = new RecordingSender();
  const dispatcher = new WebhookDispatcher(repos, sender, clock, silentLogger);
  return { clock, chain, repos, merchants, invoices, payments, scanner, tracker, sender, dispatcher };
}

describe('payment flow', () => {
  let t: ReturnType<typeof setup>;
  let merchant: Awaited<ReturnType<MerchantService['register']>>['merchant'];

  beforeEach(async () => {
    t = setup();
    ({ merchant } = await t.merchants.register({
      name: 'Coffee Shop',
      payoutAddress: MERCHANT_WALLET,
      webhookUrl: 'https://shop.example/hooks',
    }));
    await t.scanner.run(); // initialise the cursor at the current head
  });

  it('authenticates merchants only with the issued API key', async () => {
    const { apiKey } = await t.merchants.register({ name: 'Other', payoutAddress: MERCHANT_WALLET, webhookUrl: null });
    expect(apiKey).toMatch(/^cpk_/);
    expect((await t.merchants.authenticate(apiKey))?.name).toBe('Other');
    expect(await t.merchants.authenticate(apiKey + 'x')).toBeNull();
    expect(await t.merchants.authenticate('random')).toBeNull();
  });

  it('gives open invoices for the same amount different exact amounts', async () => {
    const amounts = new Set<bigint>();
    for (let i = 0; i < 50; i++) amounts.add((await t.invoices.create(merchant, { amount: '10' })).amountUnits);
    expect(amounts.size).toBe(50);
    for (const units of amounts) {
      expect(units > 10_000_000n && units < 10_010_000n).toBe(true);
    }
  });

  it('retries the tail when it collides with an open invoice', async () => {
    const tails = [7, 7, 8];
    const service = new InvoiceService(t.repos.invoices, t.repos.merchants, testChains, t.clock, 30, () => tails.shift()!);
    expect((await service.create(merchant, { amount: '5' })).amountUnits).toBe(5_000_007n);
    expect((await service.create(merchant, { amount: '5' })).amountUnits).toBe(5_000_008n);
  });

  it('fast path: customer submits the tx hash → confirming → paid → signed webhook', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '25.5', orderId: 'A-1' });
    expect(invoice.amount).toBe('25.50');
    const transfer = t.chain.pay(MERCHANT_WALLET, invoice.amountUnits);

    const submitted = await t.payments.submitTransaction(invoice.id, transfer.txHash);
    expect(submitted.status).toBe('confirming');
    expect(submitted.payment?.txHash).toBe(transfer.txHash);

    // Submitting the same hash again is harmless.
    expect((await t.payments.submitTransaction(invoice.id, transfer.txHash)).status).toBe('confirming');

    await t.tracker.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('confirming'); // 1 of 3

    t.chain.mine(2);
    await t.tracker.run();
    const paid = await t.repos.invoices.findById(invoice.id);
    expect(paid?.status).toBe('paid');
    expect(paid?.confirmations).toBe(3);

    await t.dispatcher.run();
    expect(t.sender.requests).toHaveLength(1);
    const request = t.sender.requests[0]!;
    expect(request.url).toBe('https://shop.example/hooks');
    expect(request.headers['x-cryptopay-event']).toBe('invoice.paid');
    expect(verifyWebhook(merchant.webhookSecret, request.headers['x-cryptopay-signature']!, request.body, Math.floor(t.clock.now().getTime() / 1000))).toBe(true);
    const body = JSON.parse(request.body);
    expect(body.data).toMatchObject({ id: invoice.id, status: 'paid', orderId: 'A-1', amount: '25.50' });
  });

  it('background path: the scanner finds a payment nobody reported', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '3' });
    t.chain.mine(5);
    t.chain.pay(MERCHANT_WALLET, invoice.amountUnits);
    await t.scanner.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('confirming');
  });

  it('rejects transactions that do not pay the invoice', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '10' });
    const wrongAmount = t.chain.pay(MERCHANT_WALLET, 10_000_000n);
    const wrongToken = t.chain.pay(MERCHANT_WALLET, invoice.amountUnits, { token: '0x' + '9'.repeat(40) });

    await expect(t.payments.submitTransaction(invoice.id, wrongAmount.txHash)).rejects.toMatchObject({ code: 'NO_MATCHING_TRANSFER' });
    await expect(t.payments.submitTransaction(invoice.id, wrongToken.txHash)).rejects.toMatchObject({ code: 'NO_MATCHING_TRANSFER' });
    await expect(t.payments.submitTransaction(invoice.id, '0x' + 'f'.repeat(64))).rejects.toMatchObject({ code: 'TX_NOT_FOUND' });
    await expect(t.payments.submitTransaction(invoice.id, 'nope')).rejects.toBeInstanceOf(AppError);
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('pending');
  });

  it('never credits one transfer to two invoices', async () => {
    const first = await t.invoices.create(merchant, { amount: '1' });
    const transfer = t.chain.pay(MERCHANT_WALLET, first.amountUnits);
    await t.payments.submitTransaction(first.id, transfer.txHash);
    t.chain.mine(3);
    await t.tracker.run();

    // Same tail chosen again later (allowed, the first invoice is no longer open)…
    const service = new InvoiceService(t.repos.invoices, t.repos.merchants, testChains, t.clock, 30, () =>
      Number(first.amountUnits - 1_000_000n),
    );
    const second = await service.create(merchant, { amount: '1' });
    expect(second.amountUnits).toBe(first.amountUnits);
    // …but the old transfer is still rejected for it.
    await expect(t.payments.submitTransaction(second.id, transfer.txHash)).rejects.toBeInstanceOf(AppError);
  });

  it('expires unpaid invoices only once the chain has passed the deadline', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '9', expiresInMinutes: 5 });
    t.clock.advance(6 * 60_000); // server clock is past the deadline…
    await t.scanner.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('pending'); // …but blocks are not yet

    t.chain.mine(200); // 400 s of blocks
    await t.scanner.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('expired');

    await t.dispatcher.run();
    expect(t.sender.requests[0]?.headers['x-cryptopay-event']).toBe('invoice.expired');
  });

  it('cancels only pending invoices', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '4' });
    expect((await t.invoices.cancel(merchant, invoice.id)).status).toBe('cancelled');
    await expect(t.invoices.cancel(merchant, invoice.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('survives a re-org: dropped payment goes back to pending and is found again', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '7' });
    const transfer = t.chain.pay(MERCHANT_WALLET, invoice.amountUnits);
    await t.payments.submitTransaction(invoice.id, transfer.txHash);

    // The block disappears; the same tx gets mined again 3 blocks later.
    t.chain.txs.delete(transfer.txHash);
    t.chain.mine(3);
    await t.scanner.run();
    await t.tracker.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('pending');

    const again = t.chain.pay(MERCHANT_WALLET, invoice.amountUnits, { hash: transfer.txHash });
    await t.scanner.run();
    const found = await t.repos.invoices.findById(invoice.id);
    expect(found?.status).toBe('confirming');
    expect(found?.payment?.blockNumber).toBe(again.blockNumber);
  });

  it('retries failed webhooks with back-off', async () => {
    t.sender.respond = () => ({ ok: false, error: 'HTTP 500' });
    const invoice = await t.invoices.create(merchant, { amount: '2', expiresInMinutes: 5 });
    t.chain.mine(1000);
    await t.scanner.run();
    expect((await t.repos.invoices.findById(invoice.id))?.status).toBe('expired');

    await t.dispatcher.run();
    await t.dispatcher.run(); // not due yet
    expect(t.sender.requests).toHaveLength(1);

    t.sender.respond = () => ({ ok: true, status: 200 });
    t.clock.advance(31_000);
    await t.dispatcher.run();
    expect(t.sender.requests).toHaveLength(2);
    expect(t.repos.webhooks.rows[0]?.status).toBe('delivered');
  });

  it('exposes checksummed addresses and payment links', async () => {
    const invoice = await t.invoices.create(merchant, { amount: '1' });
    const dto = new Presenter(testChains, 'https://pay.example').invoice(invoice);
    expect(dto.paymentUrl).toBe(`https://pay.example/pay/${invoice.id}`);
    expect(dto.token.address).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(dto.token.address?.toLowerCase()).toBe(TOKEN);
    expect(dto.payAmount).toMatch(/^1\.00\d{4}$/);
  });

  it('accepts plain ETH payments when the chain is configured for its native coin', async () => {
    const nativeChains = new ChainRegistry([{ ...testChain, token: { address: NATIVE, symbol: 'ETH', decimals: 18, precision: 6 } }]);
    const service = new InvoiceService(t.repos.invoices, t.repos.merchants, nativeChains, t.clock, 30);
    const invoice = await service.create(merchant, { amount: '0.0015' });
    expect(invoice.amount).toBe('0.001500');
    expect(invoice.token.address).toBe(NATIVE);
    // tail sits after the 6th decimal: 0.0015 ETH + less than 0.000001 ETH
    expect(invoice.amountUnits > 1_500_000_000_000_000n && invoice.amountUnits < 1_501_000_000_000_000n).toBe(true);
    await expect(service.create(merchant, { amount: '0.0000001' })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });

    const transfer = t.chain.pay(MERCHANT_WALLET, invoice.amountUnits, { token: NATIVE });
    expect((await t.payments.submitTransaction(invoice.id, transfer.txHash)).status).toBe('confirming');
  });

  it('can send an invoice to another address than the merchant default', async () => {
    const other = '0x3333333333333333333333333333333333333333';
    const invoice = await t.invoices.create(merchant, { amount: '2', payTo: other });
    expect(invoice.payTo).toBe(other);
    const transfer = t.chain.pay(other, invoice.amountUnits);
    expect((await t.payments.submitTransaction(invoice.id, transfer.txHash)).status).toBe('confirming');
  });
});
