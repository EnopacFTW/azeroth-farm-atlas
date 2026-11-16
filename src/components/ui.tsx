import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { errorText } from '@/services/tauri';
import { tr } from '@/i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }>(
  function Button({ variant = 'subtle', size = 'md', busy, className, children, disabled, ...rest }, ref) {
    const v: Record<Variant, string> = {
      primary: 'bg-gold text-[#1a1406] hover:bg-gold-2 font-semibold',
      subtle: 'bg-panel-3 text-ink hover:bg-line-2 border border-line',
      ghost: 'text-muted hover:text-ink hover:bg-panel-3',
      danger: 'bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25',
    };
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
          size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8.5 px-3.5 text-[13.5px]',
          v[variant],
          className,
        )}
        {...rest}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);

export function Chip({ active, onClick, children, title, tone = 'gold' }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string; tone?: 'gold' | 'info' }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors cursor-pointer',
        active
          ? tone === 'gold' ? 'border-gold/70 bg-gold/15 text-gold-2' : 'border-info/70 bg-info/15 text-info'
          : 'border-line bg-panel-2 text-muted hover:text-ink hover:border-line-2',
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', title, className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'gold'; title?: string; className?: string }) {
  const t = {
    neutral: 'bg-panel-3 text-muted border-line',
    ok: 'bg-ok/12 text-ok border-ok/35',
    warn: 'bg-warn/12 text-warn border-warn/35',
    bad: 'bg-bad/12 text-bad border-bad/35',
    info: 'bg-info/12 text-info border-info/35',
    gold: 'bg-gold/12 text-gold-2 border-gold/35',
  }[tone];
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4 whitespace-nowrap', t, className)}>
      {children}
    </span>
  );
}

export function Panel({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-8 rounded-md border border-line bg-panel-2 px-2.5 text-[13px] text-ink outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/30 disabled:opacity-50';

export function Select<T extends string>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputCls, 'pr-7', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-panel-2">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ErrorBox({ error, title = tr('Fehler', 'Error') }: { error: unknown; title?: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-bad/90">{errorText(error)}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-[13px] text-faint">{children}</div>;
}

export function Spinner({ label = tr('Lade…', 'Loading…') }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className={cx('num mt-0.5 text-[17px] font-semibold', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-panel-3 px-1.5 py-px font-mono text-[10.5px] text-muted">{children}</kbd>;
}
