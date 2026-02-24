/**
 * Shapes & Annotations - Module exports
 * 
 * Provides multi-purpose shapes and text annotations for diagrams.
 */

export { default as TextBoxNode, type TextBoxNodeData } from '../TextBoxNode';
export { default as ShapeNode, type ShapeNodeData } from '../ShapeNode';
export { default as StickyNoteNode, type StickyNoteNodeData, type StickyNoteColor } from '../StickyNoteNode';
export { 
  SHAPE_DEFINITIONS, 
  SHAPE_COLORS,
  getShapePath,
  type ShapeType,
  type ShapeDefinition,
  type ShapeOptions,
  type HandlePosition,
} from './shapeDefinitions';
