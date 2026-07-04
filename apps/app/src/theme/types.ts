// The MeetMe theme contract.
//
// Every theme (polish, fintech, …) fills these EXACT slots — same keys, different
// values — so the whole app can be re-skinned by swapping a single `Theme` object.
// Components read tokens by role (`theme.colors.textDim`) instead of raw hexes,
// which is what makes two visual versions swappable without touching component code.

export interface ThemeColors {
  // --- surfaces / backgrounds ---
  bg: string; // screen background
  surface: string; // cards, sheets, bars
  surfaceAlt: string; // insets: inputs, chips, progress-track fills

  // --- text ---
  text: string; // primary text / headings
  textDim: string; // secondary text
  textMuted: string; // tertiary text, hints, placeholders, disabled

  // --- brand / primary action ---
  primary: string; // main accent + primary CTA background
  onPrimary: string; // text/icon sitting on `primary`
  primarySoft: string; // tinted primary surface (badges, info banners)
  primaryBorder: string; // border for primary-tinted surfaces

  // --- semantic states (each with a soft tint for banners/backgrounds) ---
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;

  // --- the two counterparties (presence dots, avatars, map) ---
  buyer: string;
  seller: string;

  // --- structure / misc ---
  border: string; // hairlines, card borders
  overlay: string; // modal scrim, e.g. 'rgba(0,0,0,0.35)'
  star: string; // rating star fill
}

// 4pt spacing scale.
export interface ThemeSpacing {
  xs: number; // ~4
  sm: number; // ~8
  md: number; // ~12
  lg: number; // ~16
  xl: number; // ~24
  xxl: number; // ~32
}

export interface ThemeRadius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number; // fully rounded (use a large number, e.g. 999)
}

export interface ThemeType {
  size: { xs: number; sm: number; base: number; md: number; lg: number; xl: number; xxl: number; display: number };
  // RN fontWeight strings ('400' | '500' | '600' | '700' | '800').
  weight: { regular: string; medium: string; semibold: string; bold: string };
  // Line-height multipliers (multiply by size at the call site).
  lineHeight: { tight: number; normal: number; relaxed: number };
  // Optional custom font families (wired later once fonts are loaded); undefined = system.
  family?: { regular?: string; medium?: string; semibold?: string; bold?: string };
}

// RN style fragments (shadow* on iOS + elevation on Android). Spread into a style.
export interface ThemeShadow {
  card: object;
  sheet: object;
}

export interface ThemeMotion {
  // Durations in ms for timing-based transitions / LayoutAnimation.
  duration: { fast: number; base: number; slow: number };
  // Spring params for Moti / react-native-reanimated withSpring.
  spring: { damping: number; stiffness: number; mass: number };
  // Named easing bezier control points [x1,y1,x2,y2] for Easing.bezier(...).
  easing: {
    standard: [number, number, number, number]; // general in/out
    decelerate: [number, number, number, number]; // entering (ease-out)
    accelerate: [number, number, number, number]; // exiting (ease-in)
  };
}

export interface Theme {
  name: string; // human label, e.g. 'Polish'
  key: 'polish' | 'fintech';
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  type: ThemeType;
  shadow: ThemeShadow;
  motion: ThemeMotion;
}
