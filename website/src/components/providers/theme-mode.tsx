'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';

/** localStorage key shared with the inline boot script in the root layout. */
export const THEME_STORAGE_KEY = 'openide-theme';
const BOOT_STYLE_ID = 'openide-theme-boot';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeModeContextValue {
  mode: ThemeMode;
  resolved: ResolvedMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Stored preference: an external store backed by localStorage.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribeStored(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function getStoredMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function getServerMode(): ThemeMode {
  return 'system';
}

function writeStoredMode(mode: ThemeMode) {
  try {
    if (mode === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // Storage may be unavailable (private mode, blocked). The choice still
    // applies for the current session through the in-memory listeners.
  }
  notify();
}

// ---------------------------------------------------------------------------
// OS preference: an external store backed by matchMedia.
// ---------------------------------------------------------------------------

function subscribeSystem(listener: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function getSystemMode(): ResolvedMode {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function getServerSystemMode(): ResolvedMode {
  return 'light';
}

/**
 * Owns the light/dark preference. The server always renders `system`; the
 * stored preference is read through useSyncExternalStore, so React corrects
 * the mode right after hydration. Until then the inline boot script keeps
 * the first paint in the stored scheme.
 */
export function ThemeModeProvider({children}: {children: ReactNode}) {
  const mode = useSyncExternalStore(subscribeStored, getStoredMode, getServerMode);
  const systemMode = useSyncExternalStore(subscribeSystem, getSystemMode, getServerSystemMode);

  // Mirror the mode on <html> so browser chrome follows it. Astryx's Theme
  // does the same; keeping it here as well means the attribute is right even
  // before Theme's own effect runs.
  useEffect(() => {
    const html = document.documentElement;
    if (mode === 'system') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', mode);
    }
  }, [mode]);

  // Once React owns the mode, drop the boot override written by the inline
  // script so a later toggle is not pinned to the stored scheme.
  useEffect(() => {
    document.getElementById(BOOT_STYLE_ID)?.remove();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    writeStoredMode(next);
  }, []);

  const resolved: ResolvedMode = mode === 'system' ? systemMode : mode;

  const toggle = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const value = useMemo(
    () => ({mode, resolved, setMode, toggle}),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used inside ThemeModeProvider');
  }
  return context;
}

/**
 * Runs before hydration: mirrors the stored preference onto <html> and pins
 * the Astryx theme wrapper to that color scheme until React takes over, so
 * the first paint already has the right colors.
 */
export const themeBootScript = `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');if(m==='light'||m==='dark'){var h=document.documentElement;h.setAttribute('data-theme',m);var s=document.createElement('style');s.id='${BOOT_STYLE_ID}';s.textContent='[data-astryx-theme]{color-scheme:'+m+' !important}';h.appendChild(s);}}catch(e){}})();`;
