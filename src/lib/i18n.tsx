/**
 * CivicX bilingual system (English / हिंदी).
 *
 * One centralised translation layer for the whole product — there are no
 * duplicated Hindi components anywhere. The provider keeps the chosen language
 * in `localStorage`, exposes `t()` for code that formats its own strings, and
 * runs a single DOM-level translator that swaps the visible English wording of
 * the rendered interface for the Hindi entries in `i18n-hi.ts`.
 *
 * Only *visible* text is touched. Database values, enum members, ids, routes
 * and workflow logic are never translated: the dictionary contains display
 * wording alone, and the swap happens after React has rendered, so component
 * state and the values sent to the backend stay exactly as they were.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { hindi } from "./i18n-hi";

export type Language = "en" | "hi";

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "हिंदी",
};

const STORAGE_KEY = "civicx.language";

/** Translates one string. Unknown wording falls back to the English source. */
export function translateText(value: string, language: Language): string {
  if (language === "en") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const hit = hindi[trimmed] ?? hindi[trimmed.replace(/\s+/g, " ")];
  if (!hit) return value;
  const lead = value.slice(0, value.indexOf(trimmed[0]!));
  const tail = value.slice(lead.length + trimmed.length);
  return `${lead}${hit}${tail}`;
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  /** Translate a single string in component code. */
  t: (value: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (value) => value,
});

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Convenience hook for components that only need the translate function. */
export function useT(): (value: string) => string {
  return useContext(LanguageContext).t;
}

/* ------------------------------------------------------------------ */
/* DOM translation layer                                               */
/* ------------------------------------------------------------------ */

interface Entry {
  src: string;
  out: string;
}

const textCache = new WeakMap<Text, Entry>();
const attrCache = new WeakMap<Element, Map<string, Entry>>();

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

function skipped(node: Node | null): boolean {
  let el: Node | null = node;
  while (el) {
    if (el.nodeType === 1) {
      const element = el as Element;
      if (SKIP_TAGS.has(element.tagName)) return true;
      if (element.hasAttribute("data-no-translate")) return true;
    }
    el = el.parentNode;
  }
  return false;
}

function applyText(node: Text, language: Language): void {
  const current = node.nodeValue ?? "";
  if (current.trim().length === 0) return;
  const prev = textCache.get(node);
  const src = prev && prev.out === current ? prev.src : current;
  const next = translateText(src, language);
  if (next !== current) node.nodeValue = next;
  textCache.set(node, { src, out: next });
}

function applyAttrs(element: Element, language: Language): void {
  for (const attr of ATTRS) {
    const current = element.getAttribute(attr);
    if (current === null || current.trim().length === 0) continue;
    let map = attrCache.get(element);
    const prev = map?.get(attr);
    const src = prev && prev.out === current ? prev.src : current;
    const next = translateText(src, language);
    if (next !== current) element.setAttribute(attr, next);
    if (!map) {
      map = new Map();
      attrCache.set(element, map);
    }
    map.set(attr, { src, out: next });
  }
}

function walk(root: Node, language: Language): void {
  if (root.nodeType === 3) {
    if (!skipped(root.parentNode)) applyText(root as Text, language);
    return;
  }
  if (root.nodeType !== 1) return;
  if (skipped(root)) return;

  const element = root as Element;
  applyAttrs(element, language);

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.nodeType === 1 &&
      (SKIP_TAGS.has((node as Element).tagName) ||
        (node as Element).hasAttribute("data-no-translate"))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3) applyText(node as Text, language);
    else applyAttrs(node as Element, language);
    node = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  // Restore the saved choice after hydration so server and client markup match.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "hi" || saved === "en") setLanguageState(saved);
    } catch {
      /* storage unavailable — English stays the default */
    }
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const next: Language = current === "en" ? "hi" : "en";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Keep the rendered page in the chosen language, including anything React
  // renders later (dialogs, toasts, streamed results).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;

    let frame = 0;
    const run = () => {
      frame = 0;
      observer.disconnect();
      walk(document.body, language);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
      });
    };

    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(run);
    });

    run();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t: (text: string) => translateText(text, language),
    }),
    [language, setLanguage, toggleLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
