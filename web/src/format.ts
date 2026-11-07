import { useEffect, useState } from 'react';

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Splits "25.500437" into the amount the merchant asked for ("25.50")
 * and the unique tail ("0437") that identifies this particular invoice.
 */
export function splitAmount(payAmount: string): { main: string; tail: string } {
  const [integer, fraction = ''] = payAmount.split('.');
  const digits = fraction.padEnd(6, '0');
  return { main: `${integer}.${digits.slice(0, 2)}`, tail: digits.slice(2, 6) };
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Current time, re-rendered every second. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
