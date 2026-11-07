import { ApiError, type InvoiceStatus } from './api';

/** All interface copy lives here, so translating the app is a matter of editing one file. */

export const statusText: Record<InvoiceStatus, string> = {
  pending: 'Ожидает оплаты',
  confirming: 'Подтверждается',
  paid: 'Оплачен',
  expired: 'Истёк',
  cancelled: 'Отменён',
};

const errorText: Record<string, string> = {
  NETWORK: 'Сервер недоступен. Проверьте подключение к интернету.',
  VALIDATION_ERROR: 'Проверьте заполненные поля.',
  UNAUTHORIZED: 'Ключ не подошёл. Проверьте, что он скопирован целиком.',
  REGISTRATION_CLOSED: 'Регистрация новых магазинов закрыта администратором.',
  INVALID_AMOUNT: 'Укажите сумму от 0.01, не больше двух знаков после точки.',
  UNSUPPORTED_CHAIN: 'Эта сеть не включена на сервере.',
  INVALID_STATE: 'Статус счёта уже изменился. Обновите страницу.',
  NOT_FOUND: 'Счёт не найден.',
  INVOICE_NOT_PAYABLE: 'Этот счёт уже нельзя оплатить.',
  TX_NOT_FOUND: 'Транзакция ещё не попала в блок.',
  TX_REVERTED: 'Транзакция не прошла в сети. Деньги не списаны, кроме комиссии.',
  NO_MATCHING_TRANSFER: 'В этой транзакции нет перевода на нужную сумму и адрес.',
  TX_ALREADY_USED: 'Эта транзакция уже засчитана в другой счёт.',
  RATE_LIMITED: 'Слишком много запросов. Подождите минуту.',
  AMOUNT_SPACE_EXHAUSTED: 'Слишком много открытых счетов на эту сумму. Попробуйте позже.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details) && error.details[0]) {
      const field = (error.details[0] as { path?: string }).path;
      const label = field ? fieldNames[field] : undefined;
      if (label) return `Проверьте поле «${label}».`;
    }
    return errorText[error.code] ?? 'Что-то пошло не так. Попробуйте ещё раз.';
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

const fieldNames: Record<string, string> = {
  name: 'Название',
  payoutAddress: 'Кошелёк для выплат',
  webhookUrl: 'Адрес для уведомлений',
  amount: 'Сумма',
  description: 'Описание',
  redirectUrl: 'Ссылка возврата',
};

/** Translates wallet errors (viem/wagmi) into plain language. */
export function walletErrorMessage(error: unknown): string {
  const text = collectMessages(error).toLowerCase();
  if (text.includes('user rejected') || text.includes('user denied') || text.includes('rejected the request')) {
    return 'Вы отменили операцию в кошельке.';
  }
  if (text.includes('insufficient funds')) return 'Не хватает средств на комиссию сети.';
  if (text.includes('chain') && text.includes('mismatch')) return 'Кошелёк подключён к другой сети.';
  return 'Кошелёк вернул ошибку. Попробуйте ещё раз.';
}

function collectMessages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    const e = current as { name?: string; message?: string; shortMessage?: string; cause?: unknown };
    parts.push(e.name ?? '', e.shortMessage ?? '', e.message ?? '');
    current = e.cause;
  }
  return parts.join(' ');
}
