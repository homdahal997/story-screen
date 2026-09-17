// src/design-system/tokens.ts

export const colors = {
  // Primitives
  ink: '#0A0A0B',       // backgrounds
  bone: '#F4F1EA',      // primary text / surfaces
  signal: '#E63946',    // accent / CTAs
  ochre: '#C89B3C',     // narrative arcs
  cobalt: '#2A4B8D',    // dialogue threads
  sage: '#7A8471',      // ambient scenes
  graphite: '#2C2C2E',  // card surfaces
  fog: '#A8A8AA',       // muted text
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  display: { fontSize: 56, fontWeight: '700' as const, letterSpacing: -1.5 },
  h1: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 24, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  mono: { fontSize: 12, fontWeight: '400' as const },
} as const;

export const radii = {
  none: 0,      // modernist default — sharp corners
  subtle: 2,
} as const;

export const motion = {
  duration: 240,
  easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;
