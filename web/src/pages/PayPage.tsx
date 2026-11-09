import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { erc20Abi, formatUnits, type Hash } from 'viem';
import {
  useBalance,
  useConnection,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { api, ApiError, isFinal, type Invoice } from '../api';
import { useChain } from '../config';
import { Logo } from '../decor';
import { formatCountdown, formatDate, precisionOf, sleep, splitAmount, useNow } from '../format';
import { errorMessage, walletErrorMessage } from '../text';
import { CopyButton, ExternalLink, Menu, MenuItem, MenuLink, Notice, Title } from '../ui';
import { ConnectWallet, DisconnectItem, WalletLine } from '../wallet';

/** The customer-facing checkout, laid out like a game's title screen. */
export function PayPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const update = useCallback(
    (next: Invoice) => queryClient.setQueryData(['public-invoice', id], next),
    [queryClient, id],
  );
  const query = useQuery({
    queryKey: ['public-invoice', id],
    queryFn: () => api.publicInvoice(id),
    refetchInterval: (q) => (q.state.data && isFinal(q.state.data.status) ? false : 4000),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
  });

  if (query.isPending) {
    return (
      <Screen>
        <p className="loading glow">Загружаем счёт…</p>
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen>
        <Title sub="Проверьте ссылку или попросите продавца выставить новый счёт.">Счёт не найден</Title>
      </Screen>
    );
  }

  const invoice = query.data;
  const corner = (
    <>
      Сеть {invoice.network.name}
      {invoice.network.testnet && ' (тестовая)'}
      <br />
      {invoice.status === 'pending' && <TimeLeft expiresAt={invoice.expiresAt} />}
      {invoice.status === 'paid' && invoice.paidAt && <>Оплачен {formatDate(invoice.paidAt)}</>}
    </>
  );

  return (
    <Screen corner={corner}>
      <Title sub={invoice.description}>{invoice.merchant?.name}</Title>
      <Amount invoice={invoice} />
      {invoice.status === 'pending' ? <PayAction key={invoice.id} invoice={invoice} onUpdate={update} /> : <Outcome invoice={invoice} />}
    </Screen>
  );
}

function Screen({ children, corner }: { children: ReactNode; corner?: ReactNode }) {
  return (
    <main className="screen pay-page">
      <div className="pay-body">{children}</div>
      <footer className="pay-corners">
        <p className="corner corner-left">{corner}</p>
        <p className="corner corner-right">
          <Logo size="sm" />
        </p>
      </footer>
    </main>
  );
}

/** The exact amount, with the invoice's unique tail set apart. */
function Amount({ invoice }: { invoice: Invoice }) {
  const { main, tail } = splitAmount(invoice.payAmount, precisionOf(invoice.amount));
  return (
    <div className="amount-block">
      <p className="amount glow" aria-label={`${invoice.payAmount} ${invoice.token.symbol}`}>
        <span className="amount-figure">
          <span className="amount-main">{main}</span>
          <span className="amount-tail">{tail}</span>
        </span>
        <span className="amount-currency">{invoice.token.symbol}</span>
      </p>
      {invoice.status === 'pending' && <p className="amount-hint">последние цифры — номер вашего счёта</p>}
    </div>
  );
}

function TimeLeft({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const left = new Date(expiresAt).getTime() - now;
  return <span className={`tabular${left < 60_000 ? ' urgent' : ''}`}>{left > 0 ? `Осталось ${formatCountdown(left)}` : 'Время вышло'}</span>;
}

function PayAction({ invoice, onUpdate }: { invoice: Invoice; onUpdate: (invoice: Invoice) => void }) {
  const chain = useChain(invoice.network.chainId);
  const targetChain = invoice.network.chainId;
  const units = BigInt(invoice.payAmountUnits);
  const now = useNow();
  const expired = new Date(invoice.expiresAt).getTime() <= now;
  const [manual, setManual] = useState(false);

  const { address, chainId, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  // ETH is sent as a plain transaction; a token (USDC) through its contract's transfer().
  const native = invoice.token.address === null;
  const transfer = useWriteContract();
  const send = useSendTransaction();
  const sending = native ? send.isPending : transfer.isPending;
  const sendError = native ? send.error : transfer.error;
  const hash = (native ? send.data : transfer.data) as Hash | undefined;
  const receipt = useWaitForTransactionReceipt({ hash, chainId: targetChain });

  const balance = useReadContract({
    address: invoice.token.address ?? undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: targetChain,
    query: { enabled: Boolean(address) && !native, refetchInterval: 10_000 },
  });
  const gas = useBalance({ address, chainId: targetChain, query: { enabled: Boolean(address), refetchInterval: 10_000 } });
  const available = native ? gas.data?.value : balance.data;
  const [reportError, setReportError] = useState<string | null>(null);

  // Once the transaction is mined, tell the server right away (the background scanner is the fallback).
  useEffect(() => {
    if (!receipt.isSuccess || !hash) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        try {
          const updated = await api.submitPayment(invoice.id, hash);
          if (!cancelled) onUpdate(updated);
          return;
        } catch (error) {
          if (error instanceof ApiError && (error.code === 'TX_NOT_FOUND' || error.status === 0)) {
            await sleep(2500);
            continue;
          }
          if (!cancelled) setReportError(errorMessage(error));
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receipt.isSuccess, hash, invoice.id, onUpdate]);

  if (hash) {
    const txUrl = invoice.network.explorerUrl ? `${invoice.network.explorerUrl}/tx/${hash}` : null;
    return (
      <div className="action">
        <Progress
          label={receipt.isError ? 'Не удалось проверить транзакцию' : receipt.isSuccess ? 'Платёж в блоке, сверяем со счётом' : 'Платёж отправлен, ждём блок'}
        />
        {reportError && <Notice tone="error">{reportError}</Notice>}
        {txUrl && (
          <p className="note">
            <ExternalLink href={txUrl}>Транзакция в обозревателе</ExternalLink>
          </p>
        )}
      </div>
    );
  }

  if (expired) {
    return (
      <div className="action">
        <Notice>Время на оплату вышло. Попросите продавца выставить новый счёт.</Notice>
      </div>
    );
  }

  const manualItem = (
    <MenuItem onClick={() => setManual((v) => !v)} aria-expanded={manual}>
      {manual ? 'Скрыть реквизиты' : 'Оплатить вручную'}
    </MenuItem>
  );

  if (!isConnected || !address) {
    return (
      <div className="action">
        <Menu label="Оплата">
          <ConnectWallet />
          {manualItem}
        </Menu>
        {manual && <ManualPayment invoice={invoice} />}
      </div>
    );
  }

  const symbol = invoice.token.symbol;
  const notEnough = available !== undefined && available < units;
  const noGas = !native && gas.data !== undefined && gas.data.value === 0n;
  let primary: ReactNode;

  if (chainId !== targetChain) {
    primary = (
      <MenuItem busy={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: targetChain })}>
        Переключиться на {invoice.network.name}
      </MenuItem>
    );
  } else if (notEnough) {
    primary = <MenuItem disabled>Недостаточно {symbol}</MenuItem>;
  } else {
    primary = (
      <MenuItem
        busy={sending}
        onClick={() =>
          native || !invoice.token.address
            ? send.mutate({ to: invoice.payTo, value: units, chainId: targetChain })
            : transfer.mutate({
                address: invoice.token.address,
                abi: erc20Abi,
                functionName: 'transfer',
                args: [invoice.payTo, units],
                chainId: targetChain,
              })
        }
      >
        {sending ? 'Подтвердите в кошельке' : `Оплатить ${invoice.payAmount} ${symbol}`}
      </MenuItem>
    );
  }

  return (
    <div className="action">
      <Menu label="Оплата">
        {primary}
        {manualItem}
        <DisconnectItem />
      </Menu>
      <WalletLine />
      {notEnough && available !== undefined && (
        <p className="note">
          На кошельке {formatUnits(available, invoice.token.decimals)} {symbol}.
          {invoice.network.faucetUrl && (
            <>
              {' '}
              Тестовые {symbol} можно получить <ExternalLink href={invoice.network.faucetUrl}>здесь</ExternalLink>.
            </>
          )}
        </p>
      )}
      {noGas && !notEnough && (
        <p className="note">
          Для комиссии сети нужно немного {chain?.nativeCurrency.symbol ?? 'ETH'} в сети {invoice.network.name}.
        </p>
      )}
      {switchChain.error && <Notice tone="error">{walletErrorMessage(switchChain.error)}</Notice>}
      {sendError && <Notice tone="error">{walletErrorMessage(sendError)}</Notice>}
      {native && !notEnough && <p className="note">Комиссию сети кошелёк покажет перед подтверждением.</p>}
      {manual && <ManualPayment invoice={invoice} />}
    </div>
  );
}

/** For wallets that cannot connect to a website: send the exact amount by hand. */
function ManualPayment({ invoice }: { invoice: Invoice }) {
  return (
    <section className="manual" aria-label="Реквизиты для ручной оплаты">
      <dl className="manual-facts">
        <div>
          <dt>Адрес получателя</dt>
          <dd className="hex">{invoice.payTo}</dd>
          <CopyButton value={invoice.payTo} />
        </div>
        <div>
          <dt>Сумма — ровно</dt>
          <dd className="figure">
            {invoice.payAmount} {invoice.token.symbol}
          </dd>
          <CopyButton value={invoice.payAmount} />
        </div>
        {invoice.token.address && (
          <div>
            <dt>Контракт токена {invoice.token.symbol}</dt>
            <dd className="hex">{invoice.token.address}</dd>
            <CopyButton value={invoice.token.address} />
          </div>
        )}
      </dl>
      <p className="note">
        Отправьте ровно эту сумму в сети {invoice.network.name}: по последним цифрам мы узнаём ваш платёж. Перевод на другую
        сумму не зачислится автоматически.
      </p>
    </section>
  );
}

function Outcome({ invoice }: { invoice: Invoice }) {
  const txUrl = invoice.payment?.explorerUrl;
  if (invoice.status === 'confirming') {
    const required = invoice.requiredConfirmations ?? 1;
    return (
      <div className="action">
        <Progress label={`Платёж получен. Подтверждения сети: ${Math.min(invoice.confirmations, required)} из ${required}`} value={invoice.confirmations / required} />
        {txUrl && (
          <p className="note">
            <ExternalLink href={txUrl}>Транзакция в обозревателе</ExternalLink>
          </p>
        )}
      </div>
    );
  }
  if (invoice.status === 'paid') {
    return (
      <div className="action outcome-paid">
        <p className="paid-line glow">
          <span className="paid-seal" aria-hidden>
            <svg className="check" viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          Оплачено
        </p>
        <Menu label="Дальше">
          {invoice.redirectUrl && <MenuLink href={invoice.redirectUrl}>Вернуться в магазин</MenuLink>}
        </Menu>
        {txUrl && (
          <p className="note">
            <ExternalLink href={txUrl}>Транзакция в обозревателе</ExternalLink>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="action">
      <Notice>
        {invoice.status === 'expired'
          ? 'Срок оплаты истёк. Если вы уже отправили деньги, напишите продавцу и приложите ссылку на транзакцию.'
          : 'Продавец отменил этот счёт.'}
      </Notice>
    </div>
  );
}

function Progress({ label, value }: { label: string; value?: number }) {
  return (
    <div className="progress" role="status">
      <p className="glow">{label}</p>
      <div className={`progress-track${value === undefined ? ' progress-indeterminate' : ''}`}>
        <div className="progress-bar" style={value === undefined ? undefined : { width: `${Math.min(100, Math.max(6, value * 100))}%` }} />
      </div>
    </div>
  );
}
