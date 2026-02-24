/**
 * SVG Path Definitions for Multi-Purpose Shape Nodes
 * 
 * Each function generates an SVG path string for a given width/height.
 * Used by ShapeNode.tsx to render different geometric shapes.
 */

export type ShapeType = 
  | 'rectangle'
  | 'roundedRect'
  | 'circle'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'cylinder'
  | 'triangle'
  | 'parallelogram'
  | 'callout';

export interface ShapeDefinition {
  path: (w: number, h: number, options?: ShapeOptions) => string;
  defaultAspectRatio?: number; // width/height ratio
  handlePositions?: HandlePosition[];
}

export interface ShapeOptions {
  cornerRadius?: number;
}

export interface HandlePosition {
  position: 'top' | 'right' | 'bottom' | 'left';
  x: string; // percentage or calc expression
  y: string;
}

/**
 * Rectangle with optional corner radius
 */
const rectangle = (w: number, h: number, options?: ShapeOptions): string => {
  const r = options?.cornerRadius ?? 0;
  if (r === 0) {
    return `M 0 0 H ${w} V ${h} H 0 Z`;
  }
  return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
};

/**
 * Diamond (rhombus) - commonly used for decision nodes
 */
const diamond = (w: number, h: number): string => {
  return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
};

/**
 * Circle - fits within the bounding box
 */
const circle = (w: number, h: number): string => {
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
};

/**
 * Ellipse - stretches to fill bounding box
 */
const ellipse = (w: number, h: number): string => {
  const rx = w / 2;
  const ry = h / 2;
  return `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${rx} ${h} A ${rx} ${ry} 0 1 1 ${rx} 0 Z`;
};

/**
 * Hexagon - commonly used for process steps
 */
const hexagon = (w: number, h: number): string => {
  const inset = w * 0.25;
  return `M ${inset} 0 H ${w - inset} L ${w} ${h / 2} L ${w - inset} ${h} H ${inset} L 0 ${h / 2} Z`;
};

/**
 * Cylinder - commonly used for databases/storage
 * Top ellipse is drawn, then sides, then bottom arc
 */
const cylinder = (w: number, h: number): string => {
  const ry = Math.min(h * 0.12, 20); // Cap at 20px for very tall cylinders
  // Top ellipse
  const topPath = `M 0 ${ry} A ${w / 2} ${ry} 0 0 1 ${w} ${ry}`;
  // Right side down
  const rightSide = `V ${h - ry}`;
  // Bottom arc (visible part)
  const bottomArc = `A ${w / 2} ${ry} 0 0 1 0 ${h - ry}`;
  // Left side up (close)
  const leftSide = `V ${ry}`;
  // Inner top ellipse line (for 3D effect)
  const innerTop = `M 0 ${ry} A ${w / 2} ${ry} 0 0 0 ${w} ${ry}`;
  
  return `${topPath} ${rightSide} ${bottomArc} ${leftSide} ${innerTop}`;
};

/**
 * Triangle pointing up
 */
const triangle = (w: number, h: number): string => {
  return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;
};

/**
 * Parallelogram - commonly used for I/O in flowcharts
 */
const parallelogram = (w: number, h: number): string => {
  const skew = w * 0.2;
  return `M ${skew} 0 H ${w} L ${w - skew} ${h} H 0 Z`;
};

/**
 * Callout/Speech bubble - rectangle with a pointer tail
 */
const callout = (w: number, h: number, options?: ShapeOptions): string => {
  const r = options?.cornerRadius ?? 8;
  const tailW = 15;
  const tailH = 15;
  const tailStart = w * 0.35;
  const bodyH = h - tailH;
  
  // Start from top-left corner, go clockwise
  return `
    M ${r} 0 
    H ${w - r} 
    Q ${w} 0 ${w} ${r} 
    V ${bodyH - r} 
    Q ${w} ${bodyH} ${w - r} ${bodyH} 
    H ${tailStart + tailW} 
    L ${tailStart + tailW / 2} ${h} 
    L ${tailStart} ${bodyH} 
    H ${r} 
    Q 0 ${bodyH} 0 ${bodyH - r} 
    V ${r} 
    Q 0 0 ${r} 0 
    Z
  `.replace(/\s+/g, ' ').trim();
};

/**
 * Rounded rectangle (convenience alias)
 */
const roundedRect = (w: number, h: number, options?: ShapeOptions): string => {
  return rectangle(w, h, { cornerRadius: options?.cornerRadius ?? 12 });
};

/**
 * Shape definitions with metadata
 */
export const SHAPE_DEFINITIONS: Record<ShapeType, ShapeDefinition> = {
  rectangle: {
    path: rectangle,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  roundedRect: {
    path: roundedRect,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  circle: {
    path: circle,
    defaultAspectRatio: 1,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  ellipse: {
    path: ellipse,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  diamond: {
    path: diamond,
    defaultAspectRatio: 1,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  hexagon: {
    path: hexagon,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  cylinder: {
    path: cylinder,
    defaultAspectRatio: 0.6,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '0', y: '50%' },
    ],
  },
  triangle: {
    path: triangle,
    defaultAspectRatio: 1.15,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '75%', y: '50%' },
      { position: 'bottom', x: '50%', y: '100%' },
      { position: 'left', x: '25%', y: '50%' },
    ],
  },
  parallelogram: {
    path: parallelogram,
    handlePositions: [
      { position: 'top', x: '60%', y: '0' },
      { position: 'right', x: '90%', y: '50%' },
      { position: 'bottom', x: '40%', y: '100%' },
      { position: 'left', x: '10%', y: '50%' },
    ],
  },
  callout: {
    path: callout,
    handlePositions: [
      { position: 'top', x: '50%', y: '0' },
      { position: 'right', x: '100%', y: '40%' },
      { position: 'left', x: '0', y: '40%' },
    ],
  },
};

/**
 * Get SVG path for a shape
 */
export function getShapePath(
  shapeType: ShapeType,
  width: number,
  height: number,
  options?: ShapeOptions
): string {
  const def = SHAPE_DEFINITIONS[shapeType];
  if (!def) {
    console.warn(`Unknown shape type: ${shapeType}, falling back to rectangle`);
    return rectangle(width, height, options);
  }
  return def.path(width, height, options);
}

/**
 * Default colors for shapes
 */
export const SHAPE_COLORS = {
  fill: {
    light: '#ffffff',
    dark: '#1e293b',
  },
  stroke: {
    light: '#64748b',
    dark: '#94a3b8',
    accent: '#29B5E8',
  },
};
