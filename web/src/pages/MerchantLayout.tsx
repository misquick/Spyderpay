import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router';
import { api, ApiError, type Merchant } from '../api';
import { useAppConfig } from '../config';
import { useSession } from '../session';
import { errorMessage } from '../text';
import { Notice } from '../ui';

export interface MerchantContext {
  apiKey: string;
  merchant: Merchant;
}

export const useMerchant = () => useOutletContext<MerchantContext>();

/** Everything behind the API key: header with navigation, then the page. */
export function MerchantLayout() {
  const { appName } = useAppConfig();
  const { apiKey, signOut } = useSession();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: ['me', apiKey],
    queryFn: () => api.me(apiKey!),
    enabled: Boolean(apiKey),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      signOut();
      navigate('/', { replace: true });
    }
  }, [me.error, signOut, navigate]);

  if (!apiKey) return <Navigate to="/" replace />;

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/dashboard" className="brand">
          {appName}
        </NavLink>
        <nav>
          <NavLink to="/dashboard">Счета</NavLink>
          <NavLink to="/settings">Настройки</NavLink>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              signOut();
              navigate('/');
            }}
          >
            Выйти
          </button>
        </nav>
      </header>
      <main className="workspace">
        {me.isPending && <p className="muted">Загрузка…</p>}
        {me.isError && !(me.error instanceof ApiError && me.error.status === 401) && <Notice tone="error">{errorMessage(me.error)}</Notice>}
        {me.data && <Outlet context={{ apiKey, merchant: me.data } satisfies MerchantContext} />}
      </main>
    </div>
  );
}
