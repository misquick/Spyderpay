import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { erc20Abi, formatUnits, type Hash } from 'viem';
import { useBalance, useConnection, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { api, ApiError, isFinal, reportPayment, type Invoice } from '../api';
import { useAppConfig } from '../config';
import { shortAddress } from '../format';
import { errorMessage, walletErrorMessage } from '../text';
import { ExternalLink, Field, Menu, MenuItem, Notice, Title } from '../ui';
import { ConnectWallet } from '../wallet';
import { useMerchant } from './MerchantLayout';

type Step = 'done' | 'now' | 'todo';

/**
 * One-screen test: pick the receiving wallet, connect the paying wallet, and the
 * page creates an invoice and pays it — the full real flow, without the hand-offs.
 */
export function TestPage() {
  const { apiKey, merchant } = useMerchant();
  const config = useAppConfig();
  const [chainId, setChainId] = useState(config.defaultChainId);
  const chain = config.chains.find((c) => c.chainId === chainId) ?? config.chains[0]!;
  const native = chain.token.address === null;
  const symbol = chain.token.symbol;

  const [payTo, setPayTo] = useState<string>(merchant.payoutAddress);
  const [amount, setAmount] = useState(native ? '0.0001' : '1');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address, chainId: walletChain, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  const send = useSendTransaction();
  const write = useWriteContract();
  const hash = (native ? send.data : write.data) as Hash | undefined;
  const receipt = useWaitForTransactionReceipt({ hash, chainId });
  const balance = useBalance({ address, chainId, query: { enabled: Boolean(address) && native, refetchInterval: 8000 } });

  const live = useQuery({
    queryKey: ['public-invoice', invoice?.id],
    queryFn: () => api.publicInvoice(invoice!.id),
    enabled: Boolean(invoice),
    refetchInterval: (q) => (q.state.data && isFinal(q.state.data.status) ? false : 3000),
  });
  const current = live.data ?? invoice;

  // As soon as the transaction is in a block, tell the server (it would find it anyway, a bit later).
  useEffect(() => {
    if (!receipt.isSuccess || !hash || !invoice) return;
    reportPayment(invoice.id, hash)
      .then(() => live.refetch())
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess, hash, invoice?.id]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInvoice(null);
    send.reset();
    write.reset();
    setBusy(true);
    try {
      if (walletChain !== chainId) await switchChain.mutateAsync({ chainId });
      const created = await api.createInvoice(apiKey, {
        amount: amount.replace(',', '.'),
        chainId,
        payTo,
        description: 'Тестовый платёж',
      });
      setInvoice(created);
      const value = BigInt(created.payAmountUnits);
      if (native || !created.token.address) {
        await send.mutateAsync({ to: created.payTo, value, chainId });
      } else {
        await write.mutateAsync({ address: created.token.address, abi: erc20Abi, functionName: 'transfer', args: [created.payTo, value], chainId });
      }
    } catch (e) {
      setError(e instanceof ApiError ? errorMessage(e) : walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const status = current?.status;
  const steps: { label: string; state: Step; extra?: ReactNode }[] = [
    {
      label: 'Счёт создан',
      state: invoice ? 'done' : busy ? 'now' : 'todo',
      extra: invoice && (
        <>
          {invoice.payAmount} {invoice.token.symbol} · <ExternalLink href={invoice.paymentUrl}>страница оплаты</ExternalLink>
        </>
      ),
    },
    { label: 'Подтвердите перевод в кошельке', state: hash ? 'done' : invoice && busy ? 'now' : 'todo' },
    {
      label: 'Транзакция в блоке',
      state: receipt.isSuccess ? 'done' : hash ? 'now' : 'todo',
      extra: hash && chain.explorerUrl && <ExternalLink href={`${chain.explorerUrl}/tx/${hash}`}>{shortAddress(hash)}</ExternalLink>,
    },
    {
      label: 'Сервер нашёл платёж',
      state: status === 'confirming' || status === 'paid' ? 'done' : receipt.isSuccess ? 'now' : 'todo',
      extra: status === 'confirming' && current?.requiredConfirmations && <>подтверждения {current.confirmations} из {current.requiredConfirmations}</>,
    },
    { label: 'Оплачено', state: status === 'paid' ? 'done' : status === 'confirming' ? 'now' : 'todo' },
  ];
  const started = Boolean(invoice) || busy;
  const samePerson = address && payTo.toLowerCase() === address.toLowerCase();

  return (
    <>
      <Title sub="Создаёт счёт и сразу оплачивает его — между двумя вашими кошельками.">Проверка платежа</Title>

      <section className="section narrow">
        <form className="form" onSubmit={run}>
          {config.chains.length > 1 && (
            <Field label="Сеть" htmlFor="test-chain" hint="Та, в которой у плательщика есть тестовые монеты.">
              <select
                id="test-chain"
                value={chainId}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setChainId(next);
                  setAmount(config.chains.find((c) => c.chainId === next)?.token.address === null ? '0.0001' : '1');
                }}
              >
                {config.chains.map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.name} — {c.token.symbol}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label="Кошелёк получателя"
            htmlFor="test-to"
            hint={
              <>
                Сюда придут деньги. По умолчанию — адрес выплат магазина.
                {address && (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => setPayTo(address)}>
                      Подставить подключённый
                    </button>
                  </>
                )}
              </>
            }
          >
            <input
              id="test-to"
              className="hex"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value.trim())}
              required
              pattern="^0x[0-9a-fA-F]{40}$"
              spellCheck={false}
            />
          </Field>

          <div className="field">
            <span className="field-label">Кошелёк плательщика</span>
            {isConnected && address ? (
              <p className="payer">
                <span className="hex">{address}</span>
                {native && balance.data && (
                  <span className="payer-balance">
                    {Number(formatUnits(balance.data.value, balance.data.decimals)).toFixed(6)} {symbol}
                  </span>
                )}
              </p>
            ) : (
              <p className="payer payer-empty">Не подключён</p>
            )}
            <p className="field-hint">
              Платить будет кошелёк, подключённый к сайту.{' '}
              {isConnected ? 'Чтобы платить с другого, переключите аккаунт в самом кошельке (в Phantom — значок аккаунта вверху).' : <ConnectWallet variant="link" />}
            </p>
          </div>

          <Field label={`Сумма, ${symbol}`} htmlFor="test-amount" hint={native ? `До 6 знаков после точки. Комиссия сети оплачивается отдельно.` : 'До 2 знаков после точки.'}>
            <input id="test-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>

          {samePerson && <Notice>Получатель и плательщик — один и тот же кошелёк. Так можно, но для честной проверки выберите два разных.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}

          <Menu label="Действия">
            <MenuItem type="submit" busy={busy} disabled={!isConnected}>
              {invoice ? 'Провести ещё один платёж' : 'Провести тестовый платёж'}
            </MenuItem>
          </Menu>
          {!isConnected && <p className="note">Сначала подключите кошелёк плательщика.</p>}
        </form>
      </section>

      {started && (
        <section className="section narrow">
          <h2>Ход платежа</h2>
          <ol className="timeline">
            {steps.map((s) => (
              <li key={s.label} className={`timeline-${s.state}`}>
                <span className="timeline-label">{s.label}</span>
                {s.extra && <span className="timeline-extra">{s.extra}</span>}
              </li>
            ))}
          </ol>
          {status === 'paid' && <p className="test-result glow">Всё работает: платёж засчитан.</p>}
        </section>
      )}
    </>
  );
}
