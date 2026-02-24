/**
 * ShapeNode - Multi-purpose SVG shape node for diagrams
 * 
 * Features:
 * - 10 different shape types (rectangle, diamond, circle, hexagon, etc.)
 * - Customizable fill, stroke, and text colors
 * - Optional text label with inline editing
 * - Resizable with aspect ratio preservation for circles
 */

import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import { ShapeType, getShapePath, SHAPE_DEFINITIONS, SHAPE_COLORS } from './shapes/shapeDefinitions';
import styles from './ShapeNode.module.css';

export interface ShapeNodeData {
  shapeType: ShapeType;
  label?: string;
  width?: number;
  height?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  isDarkMode?: boolean;
  onLabelChange?: (id: string, label: string) => void;
}

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 80;

const ShapeNode: React.FC<NodeProps<ShapeNodeData>> = (props) => {
  const { id, data, selected } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    shapeType = 'rectangle',
    label = '',
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    fillColor,
    strokeColor,
    strokeWidth = 2,
    textColor,
    fontSize = 13,
    isDarkMode = false,
  } = data;

  // Get shape definition for aspect ratio handling
  const shapeDef = SHAPE_DEFINITIONS[shapeType];
  const keepAspectRatio = shapeDef?.defaultAspectRatio !== undefined;

  // Default colors based on dark mode
  const defaultFill = isDarkMode ? SHAPE_COLORS.fill.dark : SHAPE_COLORS.fill.light;
  const defaultStroke = isDarkMode ? SHAPE_COLORS.stroke.dark : SHAPE_COLORS.stroke.light;
  const defaultText = isDarkMode ? '#e2e8f0' : '#1e293b';

  // Generate SVG path
  const svgPath = useMemo(() => {
    return getShapePath(shapeType, width, height);
  }, [shapeType, width, height]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(label);
  };

  const handleBlur = () => {
    if (editValue !== label && data.onLabelChange) {
      data.onLabelChange(id, editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // CRITICAL: Stop propagation so ReactFlow doesn't capture keyboard events
    e.stopPropagation();
    
    if (e.key === 'Escape') {
      setEditValue(label);
      setIsEditing(false);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    }
  };

  // Stop all keyboard/mouse events from bubbling to ReactFlow
  const stopPropagation = (e: React.KeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className={`${styles.shapeContainer} ${isDarkMode ? styles.darkMode : ''}`}
      style={{ width, height }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Resize handles when selected */}
      {selected && (
        <NodeResizer
          minWidth={60}
          minHeight={40}
          keepAspectRatio={keepAspectRatio}
        />
      )}

      {/* SVG Shape */}
      <svg
        className={styles.shapeSvg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <path
          d={svgPath}
          fill={fillColor || defaultFill}
          stroke={strokeColor || defaultStroke}
          strokeWidth={strokeWidth}
          className={styles.shapePath}
        />
      </svg>

      {/* Text Label Overlay */}
      <div className={styles.labelContainer}>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onKeyUp={stopPropagation}
            onMouseDown={stopPropagation}
            onClick={stopPropagation}
            className={`${styles.labelInput} nodrag nowheel nopan`}
            style={{ 
              color: textColor || defaultText,
              fontSize: `${fontSize}px`,
            }}
            placeholder="Label"
          />
        ) : (
          <span 
            className={styles.labelText}
            style={{ 
              color: textColor || defaultText,
              fontSize: `${fontSize}px`,
            }}
          >
            {label || (selected ? 'Double-click to edit' : '')}
          </span>
        )}
      </div>

      {/* Connection handles - both source and target at each position */}
      <Handle
        type="source"
        position={Position.Top}
        className={styles.handle}
        id="top-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Top}
        className={styles.handle}
        id="top-target"
        isConnectable
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={styles.handle}
        id="bottom-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className={styles.handle}
        id="bottom-target"
        isConnectable
      />
      <Handle
        type="source"
        position={Position.Left}
        className={styles.handle}
        id="left-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Left}
        className={styles.handle}
        id="left-target"
        isConnectable
      />
      <Handle
        type="source"
        position={Position.Right}
        className={styles.handle}
        id="right-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Right}
        className={styles.handle}
        id="right-target"
        isConnectable
      />
    </div>
  );
};

export default memo(ShapeNode);
