import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type Invoice } from '../api';
import { useAppConfig } from '../config';
import { formatDate, shortAddress } from '../format';
import { errorMessage } from '../text';
import { Button, CopyButton, ExternalLink, Field, Notice, StatusLabel, Title } from '../ui';
import { useMerchant } from './MerchantLayout';

export function DashboardPage() {
  const { apiKey, merchant } = useMerchant();
  const invoices = useQuery({
    queryKey: ['invoices', apiKey],
    queryFn: () => api.listInvoices(apiKey),
    refetchInterval: 5000,
  });

  return (
    <>
      <Title
        sub={
          <>
            Выплаты на <span className="hex">{shortAddress(merchant.payoutAddress)}</span>
          </>
        }
      >
        {merchant.name}
      </Title>

      <NewInvoice />

      <section className="section">
        <h2>Счета</h2>
        {invoices.isError && <Notice tone="error">{errorMessage(invoices.error)}</Notice>}
        {invoices.data?.length === 0 && (
          <p className="muted">Счетов пока нет. Создайте первый и отправьте ссылку покупателю в любом мессенджере.</p>
        )}
        {invoices.data && invoices.data.length > 0 && <InvoiceTable invoices={invoices.data} />}
      </section>
    </>
  );
}

function NewInvoice() {
  const { apiKey } = useMerchant();
  const config = useAppConfig();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [chainId, setChainId] = useState(config.defaultChainId);
  const token = config.chains.find((c) => c.chainId === chainId)?.token;
  const symbol = token?.symbol ?? 'USDC';
  const precision = token?.precision ?? 2;

  const create = useMutation({
    mutationFn: () => api.createInvoice(apiKey, { amount: amount.replace(',', '.'), description, chainId }),
    onSuccess: () => {
      setAmount('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['invoices', apiKey] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section className="section">
      <h2>Новый счёт</h2>
      <form className="invoice-form" onSubmit={submit}>
        <Field label={`Сумма, ${symbol}`} htmlFor="amount">
          <input
            id="amount"
            className="tabular"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={precision > 2 ? '0.001' : '25.00'}
            required
            pattern={`^\\d{1,9}([.,]\\d{1,${precision}})?$`}
            title={`До ${precision} знаков после точки`}
          />
        </Field>
        <Field label="За что" htmlFor="description">
          <input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Заказ №1024" maxLength={200} />
        </Field>
        {config.chains.length > 1 && (
          <Field label="Сеть" htmlFor="chain">
            <select id="chain" value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
              {config.chains.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button type="submit" busy={create.isPending}>
          Создать счёт
        </Button>
      </form>
      {create.error && <Notice tone="error">{errorMessage(create.error)}</Notice>}
      {create.data && <Created invoice={create.data} />}
    </section>
  );
}

function Created({ invoice }: { invoice: Invoice }) {
  return (
    <div className="created" role="status">
      <p>
        Счёт на {invoice.amount} {invoice.token.symbol} создан. Отправьте покупателю ссылку:
      </p>
      <p className="created-link">
        <span className="hex">{invoice.paymentUrl}</span>
        <CopyButton value={invoice.paymentUrl} label="Скопировать ссылку" />
        <ExternalLink href={invoice.paymentUrl}>Открыть</ExternalLink>
      </p>
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const { apiKey } = useMerchant();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelInvoice(apiKey, id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['invoices', apiKey] }),
  });

  return (
    <div className="table-wrap">
      {cancel.error && <Notice tone="error">{errorMessage(cancel.error)}</Notice>}
      <table className="invoices">
        <thead>
          <tr>
            <th>Создан</th>
            <th>За что</th>
            <th className="num">Сумма</th>
            <th>Сеть</th>
            <th>Статус</th>
            <th>
              <span className="visually-hidden">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td className="nowrap">{formatDate(invoice.createdAt)}</td>
              <td className="description">{invoice.description || <span className="muted">—</span>}</td>
              <td className="num nowrap">
                {invoice.amount} {invoice.token.symbol}
              </td>
              <td className="nowrap">{invoice.network.name}</td>
              <td className="nowrap">
                <StatusLabel status={invoice.status} />
                {invoice.status === 'confirming' && invoice.requiredConfirmations && (
                  <span className="muted small tabular">
                    {' '}
                    {invoice.confirmations}/{invoice.requiredConfirmations}
                  </span>
                )}
              </td>
              <td className="actions nowrap">
                {invoice.payment?.explorerUrl && <ExternalLink href={invoice.payment.explorerUrl}>Транзакция</ExternalLink>}
                {invoice.status === 'pending' && (
                  <>
                    <CopyButton value={invoice.paymentUrl} label="Ссылка" />
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(invoice.id)}
                    >
                      Отменить
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
