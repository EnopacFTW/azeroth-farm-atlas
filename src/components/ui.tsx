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
      primary: 'ff-gold-fill text-[#1d1607] font-semibold hover:brightness-110 border border-[#f6dc94]/40',
      subtle: 'bg-gradient-to-b from-panel-3 to-panel-2 text-ink border border-line-2/80 hover:border-gold/40 hover:text-gold-2 shadow-[inset_0_1px_0_rgb(255_255_255/.05)]',
      ghost: 'text-muted hover:text-gold-2 hover:bg-gold/[0.07]',
      danger: 'bg-bad/12 text-bad border border-bad/40 hover:bg-bad/22',
    };
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-lg transition-all duration-150 active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
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
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-all cursor-pointer',
        active
          ? tone === 'gold'
            ? 'border-gold/70 bg-gradient-to-b from-gold/25 to-gold/10 text-gold-2 shadow-[0_0_14px_-4px_rgb(226_184_92/.6)]'
            : 'border-info/70 bg-info/15 text-info shadow-[0_0_14px_-4px_rgb(116_180_239/.6)]'
          : 'border-line bg-panel-2/80 text-muted hover:text-ink hover:border-gold/35',
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', title, className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'gold'; title?: string; className?: string }) {
  const t = {
    neutral: 'bg-panel-3/80 text-muted border-line-2/70',
    ok: 'bg-ok/10 text-ok border-ok/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    bad: 'bg-bad/10 text-bad border-bad/30',
    info: 'bg-info/10 text-info border-info/30',
    gold: 'bg-gold/10 text-gold-2 border-gold/35',
  }[tone];
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-4 whitespace-nowrap', t, className)}>
      {children}
    </span>
  );
}

export function Panel({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('ff-surface rounded-xl', className)}>
      {(title || actions) && (
        <header className="relative flex items-center justify-between gap-3 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-gold-2/90">
            <span aria-hidden className="size-1.5 rotate-45 bg-gold/80 shadow-[0_0_8px_rgb(226_184_92/.8)]" />{title}
          </h2>
          <div className="flex items-center gap-2">{actions}</div>
          <div aria-hidden className="ff-divider absolute inset-x-3 bottom-0" />
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
  'h-8 rounded-lg border border-line-2/80 bg-[#0e131c]/80 px-2.5 text-[13px] text-ink outline-none transition-colors hover:border-line-2 focus:border-gold/60 focus:ring-2 focus:ring-gold/20 disabled:opacity-50';

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
  return <div className="rounded-xl border border-dashed border-line-2/70 bg-panel/40 px-4 py-6 text-center text-[13px] text-faint">{children}</div>;
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
    <div className="relative overflow-hidden rounded-lg border border-line bg-gradient-to-b from-panel-3/70 to-panel-2/60 px-3 py-2">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
      <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-faint">{label}</div>
      <div className={cx('num mt-0.5 text-[18px] font-semibold text-ink', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-panel-3 px-1.5 py-px font-mono text-[10.5px] text-muted">{children}</kbd>;
}
