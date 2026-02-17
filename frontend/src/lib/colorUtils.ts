/**
 * Color utility functions for SnowGram diagrams.
 *
 * Extracted from App.tsx for testability. These pure functions handle:
 *  - hexToRgb: parses hex color strings to RGB components
 *  - srgbToLinear: sRGB gamma to linear conversion
 *  - luminance: WCAG 2.0 relative luminance
 *  - getLabelColor: contrast-safe label color selection
 */

// ---------------------------------------------------------------------------
// hexToRgb
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '');
  if (m.length === 3) {
    const r = parseInt(m[0] + m[0], 16);
    const g = parseInt(m[1] + m[1], 16);
    const b = parseInt(m[2] + m[2], 16);
    return { r, g, b };
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

// ---------------------------------------------------------------------------
// srgbToLinear
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  const cS = c / 255;
  return cS <= 0.04045 ? cS / 12.92 : Math.pow((cS + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------------------
// luminance
// ---------------------------------------------------------------------------

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

// ---------------------------------------------------------------------------
// getLabelColor
// ---------------------------------------------------------------------------

export function getLabelColor(fill: string, alpha: number, isDark: boolean): string {
  // In dark mode, always use light text for better contrast
  if (isDark) return '#e5f2ff';
  // In light mode, calculate based on luminance
  const base = { r: 247, g: 251, b: 255 }; // light mode background
  const { r, g, b } = hexToRgb(fill) || { r: 41, g: 181, b: 232 };
  const effLum = alpha * luminance(r, g, b) + (1 - alpha) * luminance(base.r, base.g, base.b);
  return effLum > 0.5 ? '#0F172A' : '#1a1a1a';
}
