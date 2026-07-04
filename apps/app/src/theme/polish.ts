import type { Theme } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Polish theme — an *elevated* pass over MeetMe's current green/white system look.
//
// Direction: "same app, but nicer." We keep the brand green (#2f6f5e) as primary
// and evolve everything around it:
//   • one coherent cool-slate neutral ramp replaces today's mixed grays
//     (#6b7882 / #93a1ab / #e3e8ec / #d8dee3 / #eef2f4 / #eef5f1 were on drifting
//      hues) — now a single blue-slate family, so surfaces, borders and text feel
//     like one system.
//   • secondary text darkened #6b7882 → #5c6a74 so it actually clears 4.5:1 on
//     white (it didn't before); muted text lifted for legibility too.
//   • the buyer dot is pulled OFF the primary green (both were #2f6f5e) to a
//     brighter emerald so buyer/seller/primary read as three distinct things.
//   • soft state tints unified into one warm/cool wash family; shadows are tinted
//     toward a deep green-slate (never pure black) so elevation feels calm.
//
// Extras (Polish-specific, additive — the object is still assignable to `Theme`):
// gentle CTA gradient, button/field shape tokens, a focus ring, and a hairline
// width. These let the "elevated" language be expressed without forking the API.
// ─────────────────────────────────────────────────────────────────────────────

export interface PolishTheme extends Theme {
  /** Subtle two-stop gradients. Feed straight into expo-linear-gradient `colors`. */
  gradients: {
    /** Primary CTA fill: a faint lighter→deeper green for soft dimensional depth. */
    primary: [string, string];
    /** Trust / escrow banner wash: barely-there green sheen over a tinted surface. */
    trust: [string, string];
    /** Screen backdrop: near-white cool wash from top to the flat bg. */
    screen: [string, string];
  };
  /** Canonical primary-button geometry so every CTA is the same refined shape. */
  button: {
    height: number;
    radius: number;
    paddingX: number;
    /** Scale to animate to on press (pair with motion.spring). */
    pressScale: number;
  };
  /** Canonical input/field geometry. */
  field: {
    height: number;
    radius: number;
    borderWidth: number;
  };
  /** Focus/selection ring color (primary at low opacity) for inputs & pressables. */
  focusRing: string;
  /** Hairline stroke width for dividers/borders (crisper than 1 on 2x/3x screens). */
  hairline: number;
}

export const polishTheme: PolishTheme = {
  name: 'Polish',
  key: 'polish',
  mode: 'light',

  colors: {
    // surfaces — one cool-slate ramp: white → bg → inset
    bg: '#f4f7f9',
    surface: '#ffffff',
    surfaceAlt: '#e9eef2',

    // text — slate ink, contrast-verified against white/bg
    text: '#121a20', // ~17.6:1 on white
    textDim: '#5c6a74', // ~5.6:1 on white (was #6b7882 ≈ 4.0:1, failed)
    textMuted: '#828f99', // ~3.3:1 — clearly de-emphasized but more legible than #93a1ab

    // brand / primary
    primary: '#2f6f5e', // unchanged brand green; white-on-primary ≈ 5.9:1
    onPrimary: '#ffffff',
    primarySoft: '#e7f1ed', // soft green wash for badges / info banners
    primaryBorder: '#c2ddd0', // tint border for primary surfaces

    // semantic states — unified soft-wash family
    success: '#1f9160',
    successSoft: '#e0f4e8',
    danger: '#b3382a', // kept; white-on-danger ≈ 6.0:1
    dangerSoft: '#fbeae7', // unifies #fdecea / #fdf3f2
    warning: '#c9820a',
    warningSoft: '#fbeed2',
    info: '#1c6fc9',

    // the two counterparties — pulled apart from each other and from primary
    buyer: '#38a06b', // brighter emerald: lifts off the deep primary green
    seller: '#3b6fe0', // trust blue, kept distinct from any green

    // structure
    border: '#d5dde3', // single hairline (unifies #e3e8ec / #d8dee3)
    overlay: 'rgba(18,26,32,0.45)', // slate-tinted scrim, not pure black
    star: '#f4b400',
  },

  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },

  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },

  type: {
    size: { xs: 12, sm: 14, base: 16, md: 18, lg: 20, xl: 24, xxl: 28, display: 34 },
    weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    lineHeight: { tight: 1.2, normal: 1.45, relaxed: 1.6 },
    // family omitted → system font until custom faces are wired.
  },

  shadow: {
    // small, tinted toward a deep green-slate; never pure black.
    card: {
      shadowColor: '#132b25',
      shadowOpacity: 0.07,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    // larger, casts upward for bottom sheets.
    sheet: {
      shadowColor: '#0f1a16',
      shadowOpacity: 0.14,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -8 },
      elevation: 16,
    },
  },

  motion: {
    // enter ≈ decelerate 220 · standard 200 · exit ≈ accelerate 160
    duration: { fast: 160, base: 200, slow: 220 },
    spring: { damping: 18, stiffness: 180, mass: 1 },
    easing: {
      standard: [0.4, 0, 0.2, 1],
      decelerate: [0, 0, 0.2, 1],
      accelerate: [0.4, 0, 1, 1],
    },
  },

  // ── Polish extras ──────────────────────────────────────────────────────────
  gradients: {
    primary: ['#37806c', '#2b6353'],
    trust: ['#eef6f1', '#e2efe8'],
    screen: ['#f9fbfc', '#f4f7f9'],
  },
  button: { height: 52, radius: 14, paddingX: 20, pressScale: 0.98 },
  field: { height: 52, radius: 12, borderWidth: 1 },
  focusRing: 'rgba(47,111,94,0.35)',
  hairline: 1,
};

export default polishTheme;
