import { describe, it, expect } from 'vitest';
import { getStageColor, STAGE_COLORS } from '../mermaidToReactFlow';

describe('getStageColor', () => {
  it('returns correct color for each defined stage', () => {
    for (const [key, value] of Object.entries(STAGE_COLORS)) {
      const stage = Number(key);
      const result = getStageColor(stage, false);
      expect(result.border).toBe(value.border);
      expect(result.background).toBe(value.bg);
    }
  });

  it('returns dark background for each defined stage in dark mode', () => {
    for (const [key, value] of Object.entries(STAGE_COLORS)) {
      const stage = Number(key);
      const result = getStageColor(stage, true);
      expect(result.border).toBe(value.border);
      expect(result.background).toBe(value.bgDark);
    }
  });

  it('returns neutral Snowflake blue when flowStageOrder is undefined', () => {
    const result = getStageColor(undefined, false);
    expect(result.border).toBe('#29B5E8');
    expect(result.background).toBe('#EBF8FF');
  });

  it('returns neutral dark background when flowStageOrder is undefined in dark mode', () => {
    const result = getStageColor(undefined, true);
    expect(result.border).toBe('#29B5E8');
    expect(result.background).toBe('#0C4A6E');
  });

  it('returns neutral color for out-of-range stage number', () => {
    const result = getStageColor(99, false);
    expect(result.border).toBe('#29B5E8');
    expect(result.background).toBe('#EBF8FF');
  });

  it('returns neutral color for negative stage number', () => {
    const result = getStageColor(-1, false);
    expect(result.border).toBe('#29B5E8');
  });

  it('does NOT default to green (stage 5) for unknown stages', () => {
    const greenBorder = STAGE_COLORS[5].border; // #10B981
    expect(getStageColor(undefined).border).not.toBe(greenBorder);
    expect(getStageColor(-1).border).not.toBe(greenBorder);
    expect(getStageColor(99).border).not.toBe(greenBorder);
  });

  it('floors fractional stages to nearest lower integer stage color', () => {
    // 2.5 (CDC/stream) should get stage 2 (bronze) color
    const result25 = getStageColor(2.5, false);
    expect(result25.border).toBe(STAGE_COLORS[2].border);
    expect(result25.background).toBe(STAGE_COLORS[2].bg);

    // 3.5 (silver) should get stage 3 (transform/silver) color
    const result35 = getStageColor(3.5, false);
    expect(result35.border).toBe(STAGE_COLORS[3].border);
    expect(result35.background).toBe(STAGE_COLORS[3].bg);
  });
});
