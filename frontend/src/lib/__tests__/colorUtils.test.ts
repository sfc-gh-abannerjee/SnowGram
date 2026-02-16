/**
 * Tests for color utility functions extracted from App.tsx.
 *
 * hexToRgb: parses hex color strings (#RGB or #RRGGBB) to {r, g, b}.
 * srgbToLinear: converts sRGB channel (0-255) to linear light.
 * luminance: computes relative luminance per WCAG 2.0.
 * getLabelColor: picks a contrast-safe label color for a given fill + alpha.
 */
import { describe, it, expect } from 'vitest';
import { hexToRgb, srgbToLinear, luminance, getLabelColor } from '../colorUtils';

// ---------------------------------------------------------------------------
// hexToRgb
// ---------------------------------------------------------------------------
describe('hexToRgb', () => {
  it('parses 6-digit hex: #29B5E8', () => {
    expect(hexToRgb('#29B5E8')).toEqual({ r: 41, g: 181, b: 232 });
  });

  it('parses 6-digit hex without hash: FF9900', () => {
    expect(hexToRgb('FF9900')).toEqual({ r: 255, g: 153, b: 0 });
  });

  it('parses 3-digit shorthand: #FFF', () => {
    expect(hexToRgb('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('parses 3-digit shorthand: #000', () => {
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(hexToRgb('')).toBeNull();
  });

  it('parses lowercase hex: #ff9900', () => {
    expect(hexToRgb('#ff9900')).toEqual({ r: 255, g: 153, b: 0 });
  });

  it('parses Snowflake brand blue: #29B5E8', () => {
    const result = hexToRgb('#29B5E8');
    expect(result).not.toBeNull();
    expect(result!.r).toBeLessThan(result!.b); // blue-dominant
  });
});

// ---------------------------------------------------------------------------
// srgbToLinear
// ---------------------------------------------------------------------------
describe('srgbToLinear', () => {
  it('maps 0 → 0', () => {
    expect(srgbToLinear(0)).toBe(0);
  });

  it('maps 255 → 1', () => {
    expect(srgbToLinear(255)).toBeCloseTo(1, 4);
  });

  it('maps 128 (mid-grey) to ~0.2158', () => {
    // sRGB mid-grey is NOT 0.5 linear
    const result = srgbToLinear(128);
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBeLessThan(0.25);
  });

  it('low values (< ~12) use linear segment', () => {
    // sRGB values at or below 0.04045 * 255 ≈ 10.3 use linear segment
    const linear10 = srgbToLinear(10);
    expect(linear10).toBeCloseTo(10 / 255 / 12.92, 6);
  });
});

// ---------------------------------------------------------------------------
// luminance
// ---------------------------------------------------------------------------
describe('luminance', () => {
  it('white (255,255,255) ≈ 1.0', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 2);
  });

  it('black (0,0,0) = 0', () => {
    expect(luminance(0, 0, 0)).toBe(0);
  });

  it('pure red < pure green (green has higher luminance weight)', () => {
    expect(luminance(255, 0, 0)).toBeLessThan(luminance(0, 255, 0));
  });

  it('Snowflake blue #29B5E8 has moderate luminance', () => {
    const L = luminance(41, 181, 232);
    expect(L).toBeGreaterThan(0.3);
    expect(L).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// getLabelColor
// ---------------------------------------------------------------------------
describe('getLabelColor', () => {
  it('returns light text in dark mode regardless of fill', () => {
    expect(getLabelColor('#000000', 1.0, true)).toBe('#e5f2ff');
    expect(getLabelColor('#FFFFFF', 1.0, true)).toBe('#e5f2ff');
  });

  it('returns dark text for light fills in light mode', () => {
    const result = getLabelColor('#FFFFFF', 0.5, false);
    // Should be some dark color
    expect(result).toMatch(/^#[0-1]/); // starts with low hex digit
  });

  it('returns dark text for Snowflake blue at low alpha in light mode', () => {
    // At alpha=0.08, blue is nearly invisible on light bg → high effective luminance → dark text
    const result = getLabelColor('#29B5E8', 0.08, false);
    expect(result).toMatch(/^#0/); // dark text
  });
});
