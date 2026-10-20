'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  browserLocale,
  catalogs,
  type Locale,
  type MessageKey,
} from '@/lib/i18n/catalog';

export const WARNING_VERSION = '2026-10-20.1';
export const PREFERENCE_KEYS = {
  warning: 'gunita.warning',
  locale: 'gunita.locale',
  theme: 'gunita.theme',
} as const;
export type Theme = 'system' | 'light' | 'dark';

function createPreferences() {
  let visitAck = false;
  const memory: Partial<Record<'locale' | 'theme', string>> = {};
  let storageAvailable: boolean | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  function read(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function canStore() {
    try {
      localStorage.setItem('gunita.storage-check', '1');
      localStorage.removeItem('gunita.storage-check');
      return true;
    } catch {
      return false;
    }
  }
  const snapshot = () => {
    const locale = memory.locale ?? read(PREFERENCE_KEYS.locale);
    const theme = memory.theme ?? read(PREFERENCE_KEYS.theme);
    return JSON.stringify({
      locale:
        locale === 'en' || locale === 'fil'
          ? locale
          : browserLocale(navigator.languages),
      theme: theme === 'light' || theme === 'dark' ? theme : 'system',
      acknowledged:
        read(PREFERENCE_KEYS.warning) === WARNING_VERSION || visitAck,
      ready: true,
    });
  };
  return {
    snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      storageAvailable = canStore();
      window.addEventListener('storage', emit);
      window.addEventListener('focus', emit);
      window.addEventListener('pageshow', emit);
      // Detect same-document storage clearing too; storage events only reach other tabs.
      const timer = window.setInterval(emit, 500);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', emit);
        window.removeEventListener('focus', emit);
        window.removeEventListener('pageshow', emit);
        window.clearInterval(timer);
      };
    },
    set(key: 'locale' | 'theme', value: string) {
      try {
        localStorage.setItem(PREFERENCE_KEYS[key], value);
        delete memory[key];
      } catch {
        memory[key] = value;
      }
      emit();
    },
    acknowledge() {
      const persistent = canStore();
      if (persistent) {
        try {
          localStorage.setItem(PREFERENCE_KEYS.warning, WARNING_VERSION);
        } catch {
          visitAck = true;
        }
      } else visitAck = true;
      emit();
    },
    storageAvailable: () => storageAvailable !== false,
    isAcknowledged() {
      return read(PREFERENCE_KEYS.warning) === WARNING_VERSION || visitAck;
    },
  };
}
const serverSnapshot = JSON.stringify({
  locale: 'en',
  theme: 'system',
  acknowledged: false,
  ready: false,
});
type Preferences = ReturnType<typeof createPreferences>;
type PreferenceState = {
  locale: Locale;
  theme: Theme;
  acknowledged: boolean;
  ready: boolean;
};
const Context = createContext<
  (PreferenceState & { store: Preferences }) | null
>(null);
export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [store] = useState(createPreferences);
  const value = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => serverSnapshot,
  );
  const state: PreferenceState = JSON.parse(value);
  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.documentElement.dataset.theme = state.theme;
  }, [state.locale, state.theme]);
  return <Context value={{ ...state, store }}>{children}</Context>;
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is required');
  return { ...value, t: (key: MessageKey) => catalogs[value.locale][key] };
}
export function Text({ id }: { id: MessageKey }) {
  return usePreferences().t(id);
}
export function PreferenceControls({ theme = true }: { theme?: boolean }) {
  const { locale, theme: selectedTheme, ready, store, t } = usePreferences();
  return (
    <div className="preference-controls">
      <label>
        {t('Language')}
        <select
          disabled={!ready}
          value={locale}
          onChange={(e) => store.set('locale', e.target.value)}
        >
          <option value="en" lang="en">
            English
          </option>
          <option value="fil" lang="fil">
            Filipino
          </option>
        </select>
      </label>
      {theme ? (
        <label>
          {t('Theme')}
          <select
            disabled={!ready}
            value={selectedTheme}
            onChange={(e) => store.set('theme', e.target.value)}
          >
            {(['system', 'light', 'dark'] as const).map((value) => (
              <option key={value} value={value}>
                {t(
                  ({ system: 'System', light: 'Light', dark: 'Dark' } as const)[
                    value
                  ],
                )}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
