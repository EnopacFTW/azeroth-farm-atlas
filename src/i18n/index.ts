// Two UI languages. Strings are written inline as German/English pairs: tr('Spots', 'Spots').
// The language is a module value set by <App> from the saved settings; the app shell remounts on a switch,
// so every tr() call (components and domain texts alike) is re-evaluated.

export type Lang = 'de' | 'en';

let current: Lang = 'de';

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

export function tr(de: string, en: string): string {
  return current === 'en' ? en : de;
}

/** BCP 47 locale for numbers and dates. */
export function locale(): string {
  return current === 'en' ? 'en-US' : 'de-DE';
}

export function num(v: number, opts?: Intl.NumberFormatOptions): string {
  return v.toLocaleString(locale(), opts);
}

export function dateTime(iso: string | number | Date): string {
  return new Date(iso).toLocaleString(locale());
}

export function date(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString(locale());
}

type Named = { nameDe?: string | null; nameEn?: string | null };
type Titled = { titleDe?: string | null; titleEn?: string | null };

/** Entity name in the UI language, falling back to the other one. */
export function nm(o: Named): string {
  return (current === 'en' ? o.nameEn || o.nameDe : o.nameDe || o.nameEn) ?? '';
}

/** The name in the other language when it differs (shown as subtitle / search alias). */
export function nmAlt(o: Named): string | null {
  const main = nm(o);
  const other = current === 'en' ? o.nameDe : o.nameEn;
  return other && other !== main ? other : null;
}

export function title(o: Titled): string {
  return (current === 'en' ? o.titleEn || o.titleDe : o.titleDe || o.titleEn) ?? '';
}

export function titleAlt(o: Titled): string | null {
  const main = title(o);
  const other = current === 'en' ? o.titleDe : o.titleEn;
  return other && other !== main ? other : null;
}
