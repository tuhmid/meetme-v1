// Theme runtime: holds the active theme, persists the choice, and exposes a
// hook (`useTheme`) plus a dev toggle (`ThemeToggle`) to flip Polish <-> Trust
// live on-device. Swapping the active theme re-skins the whole app because every
// component reads tokens by role (theme.colors.*) instead of raw hexes.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Theme } from './types';
import { polishTheme } from './polish';
import { fintechTheme } from './fintech';

export type { Theme } from './types';
export type ThemeKey = 'polish' | 'fintech';

export const themes: Record<ThemeKey, Theme> = { polish: polishTheme, fintech: fintechTheme };
const LABELS: Record<ThemeKey, string> = { polish: 'Polish', fintech: 'Trust' };
const STORAGE_KEY = 'meetme.themeKey';
const DEFAULT_KEY: ThemeKey = 'polish';

interface ThemeControl {
  theme: Theme;
  themeKey: ThemeKey;
  setThemeKey: (k: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeControl>({
  theme: themes[DEFAULT_KEY],
  themeKey: DEFAULT_KEY,
  setThemeKey: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setKey] = useState<ThemeKey>(DEFAULT_KEY);

  // restore the last choice on launch
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (v === 'polish' || v === 'fintech') setKey(v); })
      .catch(() => {});
  }, []);

  const setThemeKey = (k: ThemeKey) => {
    setKey(k);
    AsyncStorage.setItem(STORAGE_KEY, k).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme: themes[themeKey], themeKey, setThemeKey }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** The active theme's tokens. */
export const useTheme = (): Theme => useContext(ThemeContext).theme;
/** Full control incl. the current key + setter (for the toggle / settings). */
export const useThemeControl = (): ThemeControl => useContext(ThemeContext);

/**
 * A small segmented "Polish | Trust" control for comparing the two looks live.
 * (Dev/preview affordance — remove or gate once a direction is chosen.)
 */
export function ThemeToggle() {
  const { theme, themeKey, setThemeKey } = useThemeControl();
  const keys: ThemeKey[] = ['polish', 'fintech'];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radius.pill,
        padding: 3,
      }}
    >
      {keys.map((k) => {
        const active = k === themeKey;
        return (
          <Pressable
            key={k}
            onPress={() => setThemeKey(k)}
            hitSlop={6}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 14,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.colors.surface : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: theme.type.size.xs,
                fontWeight: active ? theme.type.weight.bold : theme.type.weight.medium,
                color: active ? theme.colors.primary : theme.colors.textMuted,
              }}
            >
              {LABELS[k]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
