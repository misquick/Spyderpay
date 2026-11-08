import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useConnection } from 'wagmi';
import { api, type Merchant } from '../api';
import { useAppConfig } from '../config';
import { Logo } from '../decor';
import { useSession } from '../session';
import { errorMessage } from '../text';
import { CopyButton, Field, Menu, MenuItem, Notice, Title } from '../ui';
import { ConnectWallet } from '../wallet';

type Screen = 'menu' | 'register' | 'login' | 'about';

/** Title screen for merchants: open a shop, sign in, or read how it works. */
export function HomePage() {
  const config = useAppConfig();
  const { apiKey } = useSession();
  const [screen, setScreen] = useState<Screen>('menu');
  const [issued, setIssued] = useState<{ merchant: Merchant; apiKey: string } | null>(null);
  const back = () => setScreen('menu');

  // Escape goes back to the main menu, like in a game.
  useEffect(() => {
    if (screen === 'menu') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setScreen('menu');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  if (issued) return <KeysIssued {...issued} />;
  if (apiKey) return <Navigate to="/dashboard" replace />;

  if (screen === 'register') return <Panel key="register" title="Открыть магазин" sub="Три поля — и можно выставлять счета."><RegisterForm onDone={setIssued} onBack={back} /></Panel>;
  if (screen === 'login') return <Panel key="login" title="Вход" sub="Ключ выдаётся один раз при открытии магазина."><LoginForm onBack={back} /></Panel>;
  if (screen === 'about') return <Panel key="about" title="Как это работает"><About onBack={back} /></Panel>;

  return (
    <main className="screen home" key="menu">
      <Logo size="lg" />
      <h1 className="home-title">Принимайте USDC напрямую на свой кошелёк</h1>
      <Menu label="Главное меню" className="home-menu">
        {config.registrationOpen && <MenuItem onClick={() => setScreen('register')}>Открыть магазин</MenuItem>}
        <MenuItem onClick={() => setScreen('login')}>Войти по ключу</MenuItem>
        <MenuItem onClick={() => setScreen('about')}>Как это работает</MenuItem>
      </Menu>
      {!config.registrationOpen && <p className="note centered">Регистрация новых магазинов закрыта администратором.</p>}
    </main>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <main className="screen panel-screen">
      <Title sub={sub}>{title}</Title>
      {children}
    </main>
  );
}

function About({ onBack }: { onBack: () => void }) {
  return (
    <>
      <ol className="steps">
        <li>Вы создаёте счёт в кабинете или через API и отправляете ссылку покупателю.</li>
        <li>К сумме добавляется уникальный «хвост» меньше цента — по нему мы узнаём именно этот счёт.</li>
        <li>Покупатель подключает MetaMask, Trust Wallet или Phantom и платит в один клик.</li>
        <li>Деньги идут прямо на ваш кошелёк. Мы не храним ключи и не держим средства.</li>
        <li>После подтверждений сети счёт становится «Оплачен», а ваш сервер получает уведомление.</li>
      </ol>
      <Menu label="Навигация">
        <MenuItem onClick={onBack}>Назад</MenuItem>
      </Menu>
    </>
  );
}

function RegisterForm({ onDone, onBack }: { onDone: (result: { merchant: Merchant; apiKey: string }) => void; onBack: () => void }) {
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
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="organization" autoFocus />
      </Field>
      <Field
        label="Кошелёк для выплат"
        htmlFor="payout"
        hint={
          <>
            Адрес EVM-кошелька (MetaMask, Trust Wallet, Phantom), на который придут деньги.
            {!connected && (
              <>
                {' '}
                <ConnectWallet label="Взять адрес из кошелька" variant="link" />
              </>
            )}
          </>
        }
      >
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
      <Field label="Адрес для уведомлений" htmlFor="webhook" hint="Необязательно. Сюда сервер сообщит об оплате (webhook).">
        <input id="webhook" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://shop.example/payments" />
      </Field>
      {register.error && <Notice tone="error">{errorMessage(register.error)}</Notice>}
      <Menu label="Действия">
        <MenuItem type="submit" busy={register.isPending}>
          Открыть магазин
        </MenuItem>
        <MenuItem onClick={onBack}>Назад</MenuItem>
      </Menu>
    </form>
  );
}

function LoginForm({ onBack }: { onBack: () => void }) {
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
      <Field label="API-ключ" htmlFor="key" hint="Начинается с cpk_.">
        <input id="key" className="hex" value={key} onChange={(e) => setKey(e.target.value)} placeholder="cpk_…" required spellCheck={false} autoComplete="off" autoFocus />
      </Field>
      {check.error && <Notice tone="error">{errorMessage(check.error)}</Notice>}
      <Menu label="Действия">
        <MenuItem type="submit" busy={check.isPending}>
          Войти
        </MenuItem>
        <MenuItem onClick={onBack}>Назад</MenuItem>
      </Menu>
    </form>
  );
}

/** Shown once after registration: the plain API key is never available again. */
function KeysIssued({ merchant, apiKey }: { merchant: Merchant; apiKey: string }) {
  const { signIn } = useSession();
  const navigate = useNavigate();
  return (
    <main className="screen panel-screen">
      <Title sub={merchant.name}>Магазин открыт. Сохраните ключи</Title>
      <p className="lead">
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
      <Menu label="Дальше">
        <MenuItem
          onClick={() => {
            signIn(apiKey);
            navigate('/dashboard');
          }}
        >
          Я сохранил ключ, перейти к счетам
        </MenuItem>
      </Menu>
    </main>
  );
}
