import type { Theme } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// MeetMe — "Trust-first Fintech" theme
//
// Direction: make MeetMe read like a modern, trustworthy money app — the calm
// authority of a Wise / Cash App / Revolut, but its own brand. The emotional job
// is "your money is protected here": safe, premium, clear. This is a full
// re-skin off the old green palette onto a deep blue-teal "ink harbor" brand.
//
// Brand thesis:
//   • primary  = #0B4F6E  deep harbor blue-teal. Blue reads as institutional
//                trust/stability; the teal undertone keeps it human and modern
//                (not cold corporate navy). Deep enough for crisp white CTAs.
//   • neutrals = cool, near-white slate grays → "clean vault" calm, never sterile.
//   • semantics= restrained: calm emerald for released/paid, a serious (not
//                alarming) brick red, a grounded amber, a level blue for info.
//   • parties  = buyer teal vs seller indigo — far apart in hue AND lightness so
//                they survive red-green colorblindness and never read as "primary".
//
// FintechTheme extends the base Theme with a few brand-specific tokens (gradients,
// a secondary accent, a glass/sheet tint config, per-component radii, a focus
// ring). It stays assignable to Theme, so the shared token API is untouched —
// components that only know about `Theme` keep working; screens that want the
// premium treatment can opt into the extras.
// ─────────────────────────────────────────────────────────────────────────────

export interface FintechTheme extends Theme {
  /** Secondary brand accent — bright aqua used for highlights / gradient sparkle. */
  accent: string;
  /** Linear-gradient stop pairs [from, to] for premium fills. */
  gradients: {
    brand: [string, string]; // primary CTA + brand fills (deep → teal)
    trust: [string, string]; // "held in escrow" banner (safe teal → harbor)
    sheet: [string, string]; // subtle wash behind sheet/modal headers
  };
  /** Frosted-sheet / glass treatment for bottom sheets & modals. */
  sheetSurface: {
    tint: string; // translucent surface laid over a blur
    blurScrim: string; // scrim rendered behind the blurred sheet
    borderTop: string; // top hairline highlight on the sheet edge
  };
  /** Per-component corner radii — the fintech language leans soft-premium. */
  componentRadius: {
    button: number;
    card: number;
    sheet: number;
    input: number;
    banner: number;
  };
  /** Focus / selected outline ring (rgba, derived from primary). */
  ring: string;
}

export const fintechTheme: FintechTheme = {
  name: 'Trust',
  key: 'fintech',
  mode: 'light',

  colors: {
    // --- surfaces / backgrounds (cool "clean vault" neutrals) ---
    bg: '#F5F7FA', // screen: very light cool gray
    surface: '#FFFFFF', // cards, sheets, bars
    surfaceAlt: '#EDF1F5', // insets: inputs, chips, progress tracks

    // --- text (near-ink slate → muted slate) ---
    text: '#0F1C2E', // primary ink (deep navy-slate)
    textDim: '#4A5A6B', // secondary slate
    textMuted: '#8A99A8', // tertiary / hints / placeholders / disabled

    // --- brand / primary action ---
    primary: '#0B4F6E', // deep harbor blue-teal — the brand + main CTA
    onPrimary: '#FFFFFF', // white on primary → contrast ≈ 8.9:1
    primarySoft: '#E4EFF3', // tinted primary surface (badges, info banners)
    primaryBorder: '#BBD4DD', // border for primary-tinted surfaces

    // --- semantic states (each with a soft tint) ---
    success: '#0E9F6E', // calm emerald: "released / paid"
    successSoft: '#E1F5EC',
    danger: '#C4362F', // serious brick red, not a fire-alarm red
    dangerSoft: '#FBE7E4',
    warning: '#B5760C', // grounded amber
    warningSoft: '#FBEFD3',
    info: '#2563B5', // level, calm blue (distinct from brand)

    // --- the two counterparties (far apart in hue + lightness) ---
    buyer: '#0D9488', // teal
    seller: '#5B54D6', // indigo

    // --- structure / misc ---
    border: '#DCE3EA', // cool hairline
    overlay: 'rgba(11,42,58,0.45)', // scrim tinted toward ink-navy (not pure black)
    star: '#F5B942', // warm gold rating star
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },

  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    pill: 999,
  },

  type: {
    size: {
      xs: 12,
      sm: 14,
      base: 16, // body ≥ 16
      md: 18,
      lg: 22,
      xl: 28,
      xxl: 34,
      display: 40,
    },
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.4,
      relaxed: 1.6,
    },
    // family omitted → system font until brand font is loaded.
  },

  shadow: {
    // Subtle, tinted toward ink-navy (never pure black).
    card: {
      shadowColor: '#0B2A3A',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    sheet: {
      shadowColor: '#0B2A3A',
      shadowOpacity: 0.14,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 14,
    },
  },

  motion: {
    // entering ~220 (decelerate), standard ~200, exiting ~160 (accelerate)
    duration: { fast: 160, base: 200, slow: 220 },
    spring: { damping: 18, stiffness: 180, mass: 1 },
    easing: {
      standard: [0.4, 0, 0.2, 1],
      decelerate: [0, 0, 0.2, 1],
      accelerate: [0.4, 0, 1, 1],
    },
  },

  // ── fintech-specific extensions ────────────────────────────────────────────
  accent: '#37B5A8', // bright aqua highlight (gradient sparkle, small accents)
  gradients: {
    brand: ['#0B4F6E', '#0A6E77'], // deep harbor → teal
    trust: ['#0E6E62', '#0B516B'], // safe teal-green → harbor blue
    sheet: ['#F5F9FB', '#EAF1F5'], // faint cool wash behind sheet headers
  },
  sheetSurface: {
    tint: 'rgba(255,255,255,0.72)',
    blurScrim: 'rgba(11,42,58,0.35)',
    borderTop: 'rgba(255,255,255,0.60)',
  },
  componentRadius: {
    button: 14,
    card: 18,
    sheet: 28,
    input: 12,
    banner: 16,
  },
  ring: 'rgba(11,79,110,0.35)',
};

export default fintechTheme;
