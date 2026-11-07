import { createBrowserRouter, Link } from 'react-router';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { MerchantLayout } from './pages/MerchantLayout';
import { PayPage } from './pages/PayPage';
import { SettingsPage } from './pages/SettingsPage';

function NotFound() {
  return (
    <main className="home">
      <h1 className="home-title">Страница не найдена</h1>
      <p className="home-lead">
        <Link to="/">На главную</Link>
      </p>
    </main>
  );
}

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/pay/:id', element: <PayPage /> },
  {
    element: <MerchantLayout />,
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
