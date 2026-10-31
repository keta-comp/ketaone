import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import kaa from "@/lib/i18n/kaa";
import ru from "@/lib/i18n/ru";
import en from "@/lib/i18n/en";

export type Lang = "uz" | "kaa" | "ru" | "en";

/** `intl` pins date/number formatting; Qaraqalpaqsha keeps the Latin Uzbek months because Intl has no "kaa" data and falls back to Russian. */
export const LANGS: { code: Lang; label: string; short: string; intl: string }[] = [
  { code: "uz", label: "O‘zbekcha", short: "UZ", intl: "uz-UZ" },
  { code: "kaa", label: "Qaraqalpaqsha", short: "KAA", intl: "uz-UZ" },
  { code: "ru", label: "Русский", short: "RU", intl: "ru-RU" },
  { code: "en", label: "English", short: "EN", intl: "en-GB" },
];

const TABLES: Record<Lang, Record<string, string>> = {
  uz: {},
  kaa,
  ru,
  en,
};

const INTL_LOCALE = Object.fromEntries(LANGS.map((lang) => [lang.code, lang.intl])) as Record<Lang, string>;

const STORAGE_KEY = "ketaone-lang";

let current: Lang = "uz";
const listeners = new Set<() => void>();

function isLang(value: string | null | undefined): value is Lang {
  return value === "uz" || value === "kaa" || value === "ru" || value === "en";
}

export function getLang(): Lang {
  return current;
}

/** Locale for `toLocale*`/`Intl` — follows the app language, not the browser's, so dates stay in the script the user picked. */
export function intlLocale(): string {
  return INTL_LOCALE[current];
}

export function setLang(lang: Lang) {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  if (typeof document !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage may be unavailable */
    }
    document.cookie = `${STORAGE_KEY}=${lang};path=/;max-age=31536000;samesite=lax`;
    document.documentElement.lang = lang === "kaa" ? "kk" : lang;
  }
  for (const listener of listeners) listener();
}

function readStoredLang(): Lang {
  if (typeof document === "undefined") return "uz";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* ignore */
  }
  const match = /(?:^|;\s*)ketaone-lang=([a-z]+)/.exec(document.cookie);
  return isLang(match?.[1]) ? (match![1] as Lang) : "uz";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLang(): Lang {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "uz" as Lang,
  );
}

/**
 * Translate an Uzbek source string (the shared key) into the active language.
 * Supports {name} placeholders: t("Jami {count} ta", { count: 4 }).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const table = TABLES[current];
  let out = current === "uz" ? key : (table[key] ?? key);
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (_full, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
    );
  }
  return out;
}

/** Remounts the tree when the language changes so plain t() calls re-evaluate. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useLang();

  useEffect(() => {
    const stored = readStoredLang();
    if (stored !== current) setLang(stored);
    else document.documentElement.lang = stored === "kaa" ? "kk" : stored;
  }, []);

  return <div key={lang} className="contents">{children}</div>;
}
