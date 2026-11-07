import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { InvoiceStatus } from './api';
import { statusText } from './text';

type Variant = 'primary' | 'secondary' | 'quiet';

export function Button({
  variant = 'primary',
  busy = false,
  wide = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn-${variant}${wide ? ' btn-wide' : ''} ${className}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function CopyButton({ value, label = 'Скопировать' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs HTTPS; fall back to a hidden textarea.
      const area = document.createElement('textarea');
      area.value = value;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className="link-button" onClick={copy} aria-live="polite">
      {copied ? 'Скопировано' : label}
    </button>
  );
}

export function StatusLabel({ status }: { status: InvoiceStatus }) {
  return <span className={`status status-${status}`}>{statusText[status]}</span>;
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'error' | 'success'; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}
