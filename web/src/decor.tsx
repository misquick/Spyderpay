import { useEffect, useRef } from 'react';

/**
 * SpyderPay decoration: warm light shafts from above, drifting embers and
 * hand-drawn ornaments with a small cobweb emblem. Everything here is
 * aria-hidden and ignores the pointer.
 */

const polar = (cx: number, cy: number, r: number, i: number, n = 8) => {
  const a = (i * 2 * Math.PI) / n;
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
};

/** A small cobweb: spokes and three octagonal rings. */
function Web({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={cx} y1={cy} x2={polar(cx, cy, r, i).split(',')[0]} y2={polar(cx, cy, r, i).split(',')[1]} />
      ))}
      {[0.38, 0.68, 0.96].map((k) => (
        <polygon key={k} points={Array.from({ length: 8 }, (_, i) => polar(cx, cy, r * k, i)).join(' ')} />
      ))}
    </g>
  );
}

const side = (m: 1 | -1) => {
  const s = (x: number) => 300 + m * x;
  return (
    <g>
      <path d={`M${s(26)} 40C${s(60)} 40 ${s(70)} 22 ${s(104)} 22C${s(138)} 22 ${s(146)} 46 ${s(124)} 50C${s(108)} 53 ${s(104)} 36 ${s(118)} 34`} />
      <path d={`M${s(104)} 22C${s(150)} 18 ${s(168)} 40 ${s(214)} 40L${s(262)} 40`} />
      <path d={`M${s(150)} 40C${s(160)} 56 ${s(184)} 58 ${s(190)} 48C${s(194)} 42 ${s(186)} 38 ${s(180)} 43`} />
      <path d={`M${s(214)} 40C${s(228)} 30 ${s(240)} 30 ${s(246)} 36`} />
      <circle cx={s(272)} cy="40" r="2.6" fill="currentColor" stroke="none" />
    </g>
  );
};

/** Scrollwork divider under titles. */
export function Ornament({ className = '' }: { className?: string }) {
  return (
    <svg className={`ornament ${className}`} viewBox="0 0 600 80" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {side(1)}
      {side(-1)}
      <Web cx={300} cy={40} r={18} />
      <path d="M300 60V74M296 70L300 76L304 70" />
    </svg>
  );
}

/** Thin arch above the main title. */
export function Arch() {
  return (
    <svg className="arch" viewBox="0 0 600 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M70 36C150 4 450 4 530 36" />
      <path d="M300 14V2" />
      <circle cx="300" cy="14" r="3" fill="currentColor" />
      <path d="M70 36C58 32 54 22 64 20C72 19 72 28 66 28" />
      <path d="M530 36C542 32 546 22 536 20C528 19 528 28 534 28" />
    </svg>
  );
}

/** Marker beside the selected menu item. */
export function Pointer({ flip = false }: { flip?: boolean }) {
  return (
    <svg className={`pointer${flip ? ' pointer-flip' : ''}`} viewBox="0 0 40 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <path d="M2 7H22" />
      <path d="M22 7l6-5 6 5-6 5z" />
      <path d="M10 7C12 2 17 2 18 5" />
      <path d="M10 7C12 12 17 12 18 9" />
    </svg>
  );
}

/** Small cobweb mark used next to the wordmark. */
export function WebMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="webmark" width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <Web cx={20} cy={20} r={17} />
    </svg>
  );
}

/** The SpyderPay wordmark. `lg` is the title-screen version with arch and ornament. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  if (size === 'lg') {
    return (
      <div className="logo-lg">
        <Arch />
        <p className="logo-word glow">SpyderPay</p>
        <Ornament />
      </div>
    );
  }
  return (
    <span className={`logo logo-${size}`}>
      <WebMark size={size === 'sm' ? 20 : 26} />
      <span className="logo-word glow">SpyderPay</span>
    </span>
  );
}

/** Drifting embers on a canvas: cheap, pauses with the tab, still when motion is reduced. */
function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // One pre-rendered glow sprite, scaled per ember.
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const s = sprite.getContext('2d')!;
    const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,228,1)');
    g.addColorStop(0.25, 'rgba(255,214,130,0.85)');
    g.addColorStop(0.6, 'rgba(255,180,80,0.18)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    s.fillStyle = g;
    s.fillRect(0, 0, 64, 64);

    let w = 0;
    let h = 0;
    type Ember = { x: number; y: number; r: number; vy: number; sway: number; phase: number; alpha: number; flicker: number };
    let embers: Ember[] = [];
    const spawn = (anywhere: boolean): Ember => {
      const depth = Math.random(); // 0 = far and sharp, 1 = near, big and soft
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 40,
        r: 2 + depth * depth * 26,
        vy: 6 + depth * 16,
        sway: 6 + Math.random() * 18,
        phase: Math.random() * Math.PI * 2,
        alpha: depth > 0.7 ? 0.18 + Math.random() * 0.2 : 0.45 + Math.random() * 0.5,
        flicker: 0.6 + Math.random() * 1.6,
      };
    };
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, Math.max(26, (w * h) / 22000)));
      embers = Array.from({ length: count }, () => spawn(true));
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i]!;
        if (!still) {
          e.y -= e.vy * dt;
          if (e.y < -40) embers[i] = spawn(false);
        }
        const x = e.x + Math.sin(t * 0.35 + e.phase) * e.sway;
        const a = e.alpha * (0.72 + 0.28 * Math.sin(t * e.flicker + e.phase));
        ctx.globalAlpha = Math.max(0, a);
        const size = e.r * 2.4;
        ctx.drawImage(sprite, x - size / 2, e.y - size / 2, size, size);
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="embers" />;
}

/** Fixed background layer, rendered once for the whole app. */
export function Decor() {
  return (
    <div className="decor" aria-hidden="true">
      <div className="sky" />
      <div className="shafts shafts-a" />
      <div className="shafts shafts-b" />
      <Embers />
      <div className="vignette" />
    </div>
  );
}
