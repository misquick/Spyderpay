import { createBrowserRouter, useNavigate } from 'react-router';
import { Menu, MenuItem, Title } from './ui';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { MerchantLayout } from './pages/MerchantLayout';
import { PayPage } from './pages/PayPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestPage } from './pages/TestPage';

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="screen panel-screen">
      <Title sub="Такой страницы нет. Проверьте ссылку.">Страница не найдена</Title>
      <Menu label="Навигация">
        <MenuItem onClick={() => navigate('/')}>На главную</MenuItem>
      </Menu>
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
      { path: '/test', element: <TestPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
