import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useConnection } from 'wagmi';
import { api, type Merchant } from '../api';
import { useAppConfig } from '../config';
import { useSession } from '../session';
import { errorMessage } from '../text';
import { Button, CopyButton, Field, Notice } from '../ui';
import { ConnectWallet } from '../wallet';

type Tab = 'register' | 'login';

/** Entry point for merchants: open a shop or sign in with an existing API key. */
export function HomePage() {
  const config = useAppConfig();
  const { apiKey } = useSession();
  const [tab, setTab] = useState<Tab>(config.registrationOpen ? 'register' : 'login');
  const [issued, setIssued] = useState<{ merchant: Merchant; apiKey: string } | null>(null);

  if (issued) return <KeysIssued {...issued} />;
  if (apiKey) return <Navigate to="/dashboard" replace />;

  return (
    <main className="home">
      <p className="brand">{config.appName}</p>
      <h1 className="home-title">Принимайте USDC напрямую на свой кошелёк</h1>
      <p className="home-lead">
        Выставьте счёт и отправьте ссылку покупателю. Он оплатит из MetaMask, Trust Wallet или Phantom, а деньги придут
        прямо на ваш адрес — без посредников и без хранения чужих ключей.
      </p>

      <div className="tabs" role="tablist">
        {config.registrationOpen && (
          <button role="tab" aria-selected={tab === 'register'} onClick={() => setTab('register')}>
            Открыть магазин
          </button>
        )}
        <button role="tab" aria-selected={tab === 'login'} onClick={() => setTab('login')}>
          Войти по ключу
        </button>
      </div>

      {tab === 'register' ? <RegisterForm onDone={setIssued} /> : <LoginForm />}
    </main>
  );
}

function RegisterForm({ onDone }: { onDone: (result: { merchant: Merchant; apiKey: string }) => void }) {
  const [name, setName] = useState('');
  const [payoutAddress, setPayoutAddress] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const { address, status } = useConnection();
  const connected = status === 'connected' && Boolean(address);
  const register = useMutation({ mutationFn: api.register, onSuccess: onDone });

  // A connected wallet fills the payout address, if the field is still empty.
  useEffect(() => {
    if (connected && address) setPayoutAddress((current) => current || address);
  }, [connected, address]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    register.mutate({ name, payoutAddress, webhookUrl: webhookUrl || null });
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Название магазина" htmlFor="name" hint="Его увидят покупатели на странице оплаты.">
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="organization" />
      </Field>
      <Field label="Кошелёк для выплат" htmlFor="payout" hint="Адрес EVM-кошелька (MetaMask, Trust Wallet, Phantom), на который придут деньги.">
        <input
          id="payout"
          className="hex"
          value={payoutAddress}
          onChange={(e) => setPayoutAddress(e.target.value.trim())}
          placeholder="0x…"
          required
          pattern="^0x[0-9a-fA-F]{40}$"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
      {!connected && <ConnectWallet label="Взять адрес из кошелька" variant="secondary" />}
      <Field label="Адрес для уведомлений" htmlFor="webhook" hint="Необязательно. Сюда сервер сообщит об оплате (webhook).">
        <input id="webhook" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://shop.example/payments" />
      </Field>
      {register.error && <Notice tone="error">{errorMessage(register.error)}</Notice>}
      <Button type="submit" wide busy={register.isPending}>
        Открыть магазин
      </Button>
    </form>
  );
}

function LoginForm() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const check = useMutation({
    mutationFn: (value: string) => api.me(value),
    onSuccess: () => {
      signIn(key);
      navigate('/dashboard');
    },
  });

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        check.mutate(key.trim());
      }}
    >
      <Field label="API-ключ" htmlFor="key" hint="Ключ выдаётся один раз при открытии магазина и начинается с cpk_.">
        <input id="key" className="hex" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cpk_…" required spellCheck={false} autoComplete="off" />
      </Field>
      {check.error && <Notice tone="error">{errorMessage(check.error)}</Notice>}
      <Button type="submit" wide busy={check.isPending}>
        Войти
      </Button>
    </form>
  );
}

/** Shown once after registration: the plain API key is never available again. */
function KeysIssued({ merchant, apiKey }: { merchant: Merchant; apiKey: string }) {
  const { signIn } = useSession();
  const navigate = useNavigate();
  return (
    <main className="home">
      <p className="brand">{merchant.name}</p>
      <h1 className="home-title">Магазин открыт. Сохраните ключи</h1>
      <p className="home-lead">
        API-ключ показывается только сейчас. Храните его в менеджере паролей или в переменных окружения сервера магазина —
        с ним можно выставлять счета от вашего имени.
      </p>
      <dl className="secrets">
        <div>
          <dt>API-ключ</dt>
          <dd className="hex">{apiKey}</dd>
          <CopyButton value={apiKey} />
        </div>
        <div>
          <dt>Секрет подписи уведомлений</dt>
          <dd className="hex">{merchant.webhookSecret}</dd>
          <CopyButton value={merchant.webhookSecret} />
        </div>
      </dl>
      <Button
        wide
        onClick={() => {
          signIn(apiKey);
          navigate('/dashboard');
        }}
      >
        Я сохранил ключ, перейти к счетам
      </Button>
    </main>
  );
}
