import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { erc20Abi, formatUnits, type Hash } from 'viem';
import {
  useBalance,
  useConnection,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { api, ApiError, isFinal, type Invoice } from '../api';
import { useChain } from '../config';
import { formatCountdown, formatDate, sleep, splitAmount, useNow } from '../format';
import { errorMessage, walletErrorMessage } from '../text';
import { Button, CopyButton, ExternalLink, Notice } from '../ui';
import { ConnectWallet, WalletLine } from '../wallet';

/** The customer-facing checkout: one sheet, one amount, one action. */
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
      <Sheet>
        <p className="muted">Загружаем счёт…</p>
      </Sheet>
    );
  }
  if (query.isError) {
    return (
      <Sheet>
        <h1 className="sheet-title">Счёт не найден</h1>
        <p className="muted">Проверьте ссылку или попросите продавца выставить новый счёт.</p>
      </Sheet>
    );
  }

  const invoice = query.data;

  return (
    <Sheet>
      <header className="sheet-head">
        <p className="merchant-name">{invoice.merchant?.name}</p>
        {invoice.description && <p className="muted">{invoice.description}</p>}
      </header>

      <Amount invoice={invoice} />

      <dl className="facts">
        <div>
          <dt>Сеть</dt>
          <dd>
            {invoice.network.name}
            {invoice.network.testnet && <span className="muted"> — тестовая</span>}
          </dd>
        </div>
        {invoice.status === 'pending' && <TimeLeft expiresAt={invoice.expiresAt} />}
        {invoice.status === 'paid' && invoice.paidAt && (
          <div>
            <dt>Оплачен</dt>
            <dd>{formatDate(invoice.paidAt)}</dd>
          </div>
        )}
      </dl>

      {invoice.status === 'pending' ? <PayAction invoice={invoice} onUpdate={update} /> : <Outcome invoice={invoice} />}
    </Sheet>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <main className="pay-page">
      <section className="sheet">{children}</section>
    </main>
  );
}

/** The exact amount, with the invoice's unique tail set apart. */
function Amount({ invoice }: { invoice: Invoice }) {
  const { main, tail } = splitAmount(invoice.payAmount);
  return (
    <p className="amount" aria-label={`${invoice.payAmount} ${invoice.token.symbol}`}>
      <span className="amount-figure">
        <span className="amount-main">{main}</span>
        <span className="amount-tail">{tail}</span>
      </span>
      <span className="amount-currency">{invoice.token.symbol}</span>
    </p>
  );
}

function TimeLeft({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const left = new Date(expiresAt).getTime() - now;
  return (
    <div>
      <dt>Осталось</dt>
      <dd className="tabular">{left > 0 ? formatCountdown(left) : 'время вышло'}</dd>
    </div>
  );
}

function PayAction({ invoice, onUpdate }: { invoice: Invoice; onUpdate: (invoice: Invoice) => void }) {
  const chain = useChain(invoice.network.chainId);
  const targetChain = invoice.network.chainId;
  const units = BigInt(invoice.payAmountUnits);
  const now = useNow();
  const expired = new Date(invoice.expiresAt).getTime() <= now;

  const { address, chainId, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  const transfer = useWriteContract();
  const hash = transfer.data as Hash | undefined;
  const receipt = useWaitForTransactionReceipt({ hash, chainId: targetChain });

  const balance = useReadContract({
    address: invoice.token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: targetChain,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });
  const gas = useBalance({ address, chainId: targetChain, query: { enabled: Boolean(address) } });
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
          <p className="muted small">
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

  if (!isConnected || !address) {
    return (
      <div className="action">
        <ConnectWallet />
        <ManualPayment invoice={invoice} />
      </div>
    );
  }

  const symbol = invoice.token.symbol;
  const notEnough = balance.data !== undefined && balance.data < units;
  const noGas = gas.data !== undefined && gas.data.value === 0n;
  let button: ReactNode;

  if (chainId !== targetChain) {
    button = (
      <Button wide busy={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: targetChain })}>
        Переключиться на {invoice.network.name}
      </Button>
    );
  } else if (notEnough) {
    button = (
      <Button wide disabled>
        Недостаточно {symbol}
      </Button>
    );
  } else {
    button = (
      <Button
        wide
        busy={transfer.isPending}
        onClick={() =>
          transfer.mutate({
            address: invoice.token.address,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [invoice.payTo, units],
            chainId: targetChain,
          })
        }
      >
        {transfer.isPending ? 'Подтвердите в кошельке' : `Оплатить ${invoice.payAmount} ${symbol}`}
      </Button>
    );
  }

  return (
    <div className="action">
      {button}
      {notEnough && balance.data !== undefined && (
        <p className="muted small">
          На кошельке {formatUnits(balance.data, invoice.token.decimals)} {symbol}.
          {invoice.network.faucetUrl && (
            <>
              {' '}
              Тестовые {symbol} можно получить в <ExternalLink href={invoice.network.faucetUrl}>кране Circle</ExternalLink>.
            </>
          )}
        </p>
      )}
      {noGas && !notEnough && (
        <p className="muted small">
          Для комиссии сети нужно немного {chain?.nativeCurrency.symbol ?? 'ETH'} в сети {invoice.network.name}.
        </p>
      )}
      {switchChain.error && <Notice tone="error">{walletErrorMessage(switchChain.error)}</Notice>}
      {transfer.error && <Notice tone="error">{walletErrorMessage(transfer.error)}</Notice>}
      <WalletLine />
      <ManualPayment invoice={invoice} />
    </div>
  );
}

/** For wallets that cannot connect to a website: send the exact amount by hand. */
function ManualPayment({ invoice }: { invoice: Invoice }) {
  return (
    <details className="manual">
      <summary>Оплатить вручную с другого кошелька</summary>
      <dl className="facts facts-stacked">
        <div>
          <dt>Адрес получателя</dt>
          <dd className="hex">{invoice.payTo}</dd>
          <CopyButton value={invoice.payTo} />
        </div>
        <div>
          <dt>Сумма — ровно</dt>
          <dd className="tabular">
            {invoice.payAmount} {invoice.token.symbol}
          </dd>
          <CopyButton value={invoice.payAmount} />
        </div>
        <div>
          <dt>Контракт токена {invoice.token.symbol}</dt>
          <dd className="hex">{invoice.token.address}</dd>
          <CopyButton value={invoice.token.address} />
        </div>
      </dl>
      <p className="muted small">
        Отправьте ровно эту сумму в сети {invoice.network.name}: по последним цифрам мы узнаём ваш платёж. Перевод на другую
        сумму не зачислится автоматически.
      </p>
    </details>
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
          <p className="muted small">
            <ExternalLink href={txUrl}>Транзакция в обозревателе</ExternalLink>
          </p>
        )}
      </div>
    );
  }
  if (invoice.status === 'paid') {
    return (
      <div className="action outcome-paid">
        <p className="paid-line">
          <svg className="check" viewBox="0 0 24 24" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Оплачено
        </p>
        {invoice.redirectUrl && (
          <a className="btn btn-primary btn-wide" href={invoice.redirectUrl}>
            Вернуться в магазин
          </a>
        )}
        {txUrl && (
          <p className="muted small">
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
      <p>{label}</p>
      <div className={`progress-track${value === undefined ? ' progress-indeterminate' : ''}`}>
        <div className="progress-bar" style={value === undefined ? undefined : { width: `${Math.min(100, Math.max(6, value * 100))}%` }} />
      </div>
    </div>
  );
}
