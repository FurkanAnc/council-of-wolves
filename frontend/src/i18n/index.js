/**
 * Tiny i18n: Turkish and English UI strings.
 *
 * t(key, vars) looks the key up in the current language (falling back to
 * Turkish), and fills {name} placeholders from `vars`. A value may also be an
 * array or object (example questions, templates). The language is module
 * state; App keeps it in React state too, so changing it re-renders the tree.
 */

import { strings } from './strings';

const LANG_KEY = 'council-lang';

export const LANGUAGES = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    // Storage unavailable: fall back to the browser language
  }
  return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let current = detect();
document.documentElement.lang = current;

export function getLanguage() {
  return current;
}

export function setLanguage(lang) {
  current = lang === 'tr' ? 'tr' : 'en';
  document.documentElement.lang = current;
  try {
    localStorage.setItem(LANG_KEY, current);
  } catch {
    // The choice still applies for this visit
  }
}

/** Locale for dates and numbers. */
export function locale() {
  return current === 'tr' ? 'tr-TR' : 'en-US';
}

export function t(key, vars) {
  let value = strings[current]?.[key] ?? strings.tr[key] ?? key;
  if (typeof value === 'string' && vars) {
    for (const [name, v] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(v));
    }
  }
  return value;
}

/** Case-insensitive search in the current language (Turkish dotted/dotless i). */
export function lower(text) {
  return (text || '').toLocaleLowerCase(locale());
}
