import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorMessage } from '../text';
import { Button, CopyButton, Field, Notice } from '../ui';
import { useMerchant } from './MerchantLayout';

export function SettingsPage() {
  const { apiKey, merchant } = useMerchant();
  const queryClient = useQueryClient();
  const [name, setName] = useState(merchant.name);
  const [payoutAddress, setPayoutAddress] = useState<string>(merchant.payoutAddress);
  const [webhookUrl, setWebhookUrl] = useState(merchant.webhookUrl ?? '');
  const [showSecret, setShowSecret] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updateMe(apiKey, { name, payoutAddress: payoutAddress as `0x${string}`, webhookUrl: webhookUrl || null }),
    onSuccess: (updated) => queryClient.setQueryData(['me', apiKey], updated),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const origin = window.location.origin;
  const example = `curl -X POST ${origin}/api/invoices \\
  -H "Authorization: Bearer $CRYPTOPAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": "25.00", "orderId": "1024"}'`;

  return (
    <>
      <div className="page-head">
        <h1>Настройки</h1>
      </div>

      <section className="section narrow">
        <form className="form" onSubmit={submit}>
          <Field label="Название магазина" htmlFor="name">
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
          </Field>
          <Field label="Кошелёк для выплат" htmlFor="payout" hint="Новый адрес применится к счетам, созданным после сохранения.">
            <input
              id="payout"
              className="hex"
              value={payoutAddress}
              onChange={(e) => setPayoutAddress(e.target.value.trim())}
              required
              pattern="^0x[0-9a-fA-F]{40}$"
              spellCheck={false}
            />
          </Field>
          <Field label="Адрес для уведомлений" htmlFor="webhook" hint="Сюда приходят события invoice.paid и invoice.expired.">
            <input id="webhook" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://shop.example/payments" />
          </Field>
          {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
          {save.isSuccess && !save.isPending && <Notice tone="success">Сохранено.</Notice>}
          <Button type="submit" busy={save.isPending}>
            Сохранить
          </Button>
        </form>
      </section>

      <section className="section narrow">
        <h2>Подпись уведомлений</h2>
        <p className="muted">
          Каждое уведомление подписано HMAC-SHA256 в заголовке <code>X-CryptoPay-Signature</code>. Проверяйте подпись этим
          секретом, прежде чем отмечать заказ оплаченным.
        </p>
        <p className="secret-line">
          <span className="hex">{showSecret ? merchant.webhookSecret : '•'.repeat(24)}</span>
          <button type="button" className="link-button" onClick={() => setShowSecret((v) => !v)}>
            {showSecret ? 'Скрыть' : 'Показать'}
          </button>
          <CopyButton value={merchant.webhookSecret} />
        </p>
      </section>

      <section className="section narrow">
        <h2>Счета из кода магазина</h2>
        <p className="muted">Создавайте счета с сервера магазина, передавая API-ключ в заголовке. Ответ содержит ссылку на оплату в поле <code>paymentUrl</code>.</p>
        <pre className="code">{example}</pre>
      </section>
    </>
  );
}
