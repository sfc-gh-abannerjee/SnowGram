/**
 * Text measurement utilities for dynamic node sizing.
 * 
 * Uses HTML canvas 2D context to measure text width accurately,
 * enabling nodes to resize based on their label content.
 */

// Lazy-initialized canvas for text measurement (avoids SSR issues)
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCanvas = document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d');
    if (!measureCtx) {
      throw new Error('Failed to create canvas 2D context');
    }
  }
  return measureCtx;
}

/**
 * Canonical node dimension constants.
 *
 * Every file that needs a node width or height MUST import from here.
 * This eliminates the 4-file divergence (elkLayout, layoutUtils, CSS, textMeasure)
 * that caused label overflow and handle misalignment.
 */
export const NODE_DIMENSIONS = {
  /** Minimum node width (short labels) */
  WIDTH_MIN: 150,
  /** Default width used when no dynamic measurement is available */
  WIDTH_DEFAULT: 200,
  /** Maximum node width (long labels like "Snowflake Connector for Kafka") */
  WIDTH_MAX: 280,
  /** Default node height */
  HEIGHT_DEFAULT: 130,
  /** Horizontal padding inside node for label text */
  LABEL_PAD_X: 12,
  /** Vertical padding inside node for label text */
  LABEL_PAD_Y: 8,
  /** Column width for lane-based layouts (node width + inter-node gap) */
  LANE_COLUMN_WIDTH: 250,
  /** Column width for section-based layouts */
  SECTION_COLUMN_WIDTH: 230,
  /** Spacing between grid columns */
  COL_SPACING: 150,
} as const;

/**
 * Layout constraints for text measurement (used by measureNodeWidth / calculateNodeDimensions).
 *
 * @deprecated Prefer importing from {@link NODE_DIMENSIONS} for width/height constants.
 *   This object is retained for backwards-compat with callers that reference
 *   MIN_WIDTH / MAX_WIDTH — those now delegate to NODE_DIMENSIONS.
 */
export const NODE_SIZE_CONSTRAINTS = {
  MIN_WIDTH: NODE_DIMENSIONS.WIDTH_MIN,
  MAX_WIDTH: NODE_DIMENSIONS.WIDTH_MAX,
  ICON_WIDTH: 40,
  HORIZONTAL_PADDING: 32,
  DEFAULT_FONT_SIZE: 13,
  DEFAULT_FONT_FAMILY: 'Inter, system-ui, -apple-system, sans-serif',
  LINE_HEIGHT: 1.4,
  MAX_LINES: 2,
} as const;

/**
 * Measure the width needed for a node based on its label text.
 * 
 * @param label - The text label to measure
 * @param fontSize - Font size in pixels (default: 13)
 * @param hasIcon - Whether node has an icon (default: true)
 * @returns Calculated width in pixels, clamped to min/max constraints
 */
export function measureNodeWidth(
  label: string,
  fontSize: number = NODE_SIZE_CONSTRAINTS.DEFAULT_FONT_SIZE,
  hasIcon: boolean = true
): number {
  if (!label || typeof window === 'undefined') {
    return NODE_SIZE_CONSTRAINTS.MIN_WIDTH;
  }

  try {
    const ctx = getContext();
    ctx.font = `${fontSize}px ${NODE_SIZE_CONSTRAINTS.DEFAULT_FONT_FAMILY}`;
    
    const textWidth = ctx.measureText(label).width;
    const iconWidth = hasIcon ? NODE_SIZE_CONSTRAINTS.ICON_WIDTH : 0;
    const calculatedWidth = textWidth + iconWidth + NODE_SIZE_CONSTRAINTS.HORIZONTAL_PADDING;
    
    // Clamp to constraints
    return Math.max(
      NODE_SIZE_CONSTRAINTS.MIN_WIDTH,
      Math.min(NODE_SIZE_CONSTRAINTS.MAX_WIDTH, Math.ceil(calculatedWidth))
    );
  } catch {
    // Fallback for SSR or canvas errors
    return NODE_SIZE_CONSTRAINTS.MIN_WIDTH;
  }
}

/**
 * Calculate appropriate node dimensions for a label.
 * Handles text wrapping for long labels.
 * 
 * @param label - The text label
 * @param options - Optional configuration
 * @returns Object with width, height, and whether text should wrap
 */
export function calculateNodeDimensions(
  label: string,
  options: {
    fontSize?: number;
    hasIcon?: boolean;
    baseHeight?: number;
  } = {}
): { width: number; height: number; shouldWrap: boolean } {
  const {
    fontSize = NODE_SIZE_CONSTRAINTS.DEFAULT_FONT_SIZE,
    hasIcon = true,
    baseHeight = 130,
  } = options;

  if (!label || typeof window === 'undefined') {
    return { width: NODE_SIZE_CONSTRAINTS.MIN_WIDTH, height: baseHeight, shouldWrap: false };
  }

  try {
    const ctx = getContext();
    ctx.font = `${fontSize}px ${NODE_SIZE_CONSTRAINTS.DEFAULT_FONT_FAMILY}`;
    
    const textWidth = ctx.measureText(label).width;
    const iconWidth = hasIcon ? NODE_SIZE_CONSTRAINTS.ICON_WIDTH : 0;
    const availableWidth = NODE_SIZE_CONSTRAINTS.MAX_WIDTH - iconWidth - NODE_SIZE_CONSTRAINTS.HORIZONTAL_PADDING;
    
    // Check if text needs wrapping
    const shouldWrap = textWidth > availableWidth;
    
    if (shouldWrap) {
      // For wrapped text, use max width and increase height
      const estimatedLines = Math.min(
        Math.ceil(textWidth / availableWidth),
        NODE_SIZE_CONSTRAINTS.MAX_LINES
      );
      const lineHeight = fontSize * NODE_SIZE_CONSTRAINTS.LINE_HEIGHT;
      const extraHeight = (estimatedLines - 1) * lineHeight;
      
      return {
        width: NODE_SIZE_CONSTRAINTS.MAX_WIDTH,
        height: baseHeight + extraHeight,
        shouldWrap: true,
      };
    }
    
    // No wrapping needed - calculate exact width
    const calculatedWidth = textWidth + iconWidth + NODE_SIZE_CONSTRAINTS.HORIZONTAL_PADDING;
    
    return {
      width: Math.max(NODE_SIZE_CONSTRAINTS.MIN_WIDTH, Math.ceil(calculatedWidth)),
      height: baseHeight,
      shouldWrap: false,
    };
  } catch {
    return { width: NODE_SIZE_CONSTRAINTS.MIN_WIDTH, height: baseHeight, shouldWrap: false };
  }
}

/**
 * Pre-calculate dimensions for a batch of nodes.
 * More efficient than calling measureNodeWidth repeatedly.
 * 
 * @param labels - Array of labels to measure
 * @param options - Optional configuration
 * @returns Map of label to dimensions
 */
export function batchMeasureNodeDimensions(
  labels: string[],
  options: { fontSize?: number; hasIcon?: boolean; baseHeight?: number } = {}
): Map<string, { width: number; height: number; shouldWrap: boolean }> {
  const results = new Map<string, { width: number; height: number; shouldWrap: boolean }>();
  
  for (const label of labels) {
    if (!results.has(label)) {
      results.set(label, calculateNodeDimensions(label, options));
    }
  }
  
  return results;
}
