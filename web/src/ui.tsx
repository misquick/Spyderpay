import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import type { InvoiceStatus } from './api';
import { Ornament, Pointer } from './decor';
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

const ITEM = '.menu-item:not(:disabled)';

/**
 * A vertical menu like a game's title screen: the pointers glide to the item
 * under the mouse or keyboard focus, arrow keys move between items.
 */
export function Menu({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const measure = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(ITEM));
    const target = active && root.contains(active) && items.includes(active) ? active : items[0];
    const labelEl = target?.querySelector<HTMLElement>('.menu-label');
    if (!target || !labelEl) {
      setBox(null);
      return;
    }
    // Layout offsets, not screen rects: unaffected by the items' entrance animation.
    const next = {
      top: target.offsetTop + labelEl.offsetTop,
      left: target.offsetLeft + labelEl.offsetLeft,
      width: labelEl.offsetWidth,
      height: labelEl.offsetHeight,
    };
    setBox((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [active]);

  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [measure]);

  const pick = (event: SyntheticEvent) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (item && item !== active) setActive(item);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = items.at((current + step + items.length) % items.length) ?? items[0]!;
    next.focus();
    setActive(next);
  };

  return (
    <div ref={ref} className={`menu ${className}`} role="group" aria-label={label} onMouseOver={pick} onFocus={pick} onKeyDown={onKeyDown} onAnimationEnd={measure}>
      {children}
      {box && (
        <span className="menu-pointers" style={{ transform: `translateY(${box.top}px)`, height: box.height }} aria-hidden="true">
          <span className="menu-glow" style={{ left: box.left - 30, width: box.width + 60 }} />
          <span className="menu-pointer-left" style={{ left: box.left - 58 }}>
            <Pointer />
          </span>
          <span className="menu-pointer-right" style={{ left: box.left + box.width + 18 }}>
            <Pointer flip />
          </span>
        </span>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  busy = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button type="button" {...props} className={`menu-item ${className}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>
      <span className="menu-label">
        {busy && <span className="spinner" aria-hidden />}
        {children}
      </span>
    </button>
  );
}

/** A menu entry that is a plain link (e.g. back to the shop). */
export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="menu-item" href={href}>
      <span className="menu-label">{children}</span>
    </a>
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
    <button type="button" className={`link-button${copied ? ' is-done' : ''}`} onClick={copy} aria-live="polite">
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

/** Page title with the scroll ornament under it. */
export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="title-block">
      <h1 className="title glow">{children}</h1>
      <Ornament />
      {sub && <p className="subtitle">{sub}</p>}
    </header>
  );
}

