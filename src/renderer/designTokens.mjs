// Design tokens for the Phase 3 main-window renderer.
//
// A single source of truth for spacing, type, and the color scale so every
// component module (StatusRibbon, RunCard, Sidebar, …) shares one vocabulary
// instead of hard-coding ad-hoc values. Pure data only — no DOM, no imports —
// so it is trivially testable in Node and safe to import from any renderer
// module. Colors follow the existing app shell's light/near-white surfaces plus
// a fixed semantic scale (danger/warning/success/info) used by the connection
// state machine and run feedback.

export const spacing = Object.freeze({
  none: '0',
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
});

export const font = Object.freeze({
  sizeXs: '11px',
  sizeSm: '12px',
  sizeMd: '13px',
  sizeLg: '15px',
  sizeXl: '18px',
  sizeXxl: '22px',
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  familyMono: 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace',
});

export const radius = Object.freeze({
  sm: '4px',
  md: '8px',
  lg: '12px',
  pill: '999px',
});

// Semantic color scale. `surface` and `surfaceRaised` intentionally differ by a
// small step so nested cards read as layered without introducing new hues.
export const color = Object.freeze({
  bg: '#f6f7f9',
  surface: '#ffffff',
  surfaceRaised: '#fbfcfd',
  border: '#e2e5ea',
  text: '#1c2024',
  textMuted: '#5b636c',
  textSubtle: '#8a929c',
  accent: '#2f6feb',
  accentSoft: '#e8f0fe',
  danger: '#c0392b',
  dangerSoft: '#fdecea',
  warning: '#b7791f',
  warningSoft: '#fdf3e2',
  success: '#1e8e5a',
  successSoft: '#e7f6ee',
  info: '#2f6feb',
  infoSoft: '#e8f0fe',
});

// Maps a connection / run state to the token pair the ribbon and cards use.
export const stateTone = Object.freeze({
  idle: 'muted',
  ready: 'success',
  verifying: 'info',
  running: 'info',
  'sign-in-required': 'warning',
  blocked: 'danger',
  attention: 'warning',
});

export const designTokens = Object.freeze({
  spacing,
  font,
  radius,
  color,
  stateTone,
});

export default designTokens;
