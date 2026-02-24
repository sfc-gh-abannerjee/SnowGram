/**
 * StickyNoteNode - Styled sticky note annotation for diagrams
 * 
 * Features:
 * - Classic sticky note appearance with folded corner
 * - Multiple color options (yellow, pink, blue, green, purple)
 * - Inline text editing
 * - Shadow and depth effects
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import styles from './StickyNoteNode.module.css';

export type StickyNoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'orange';

export interface StickyNoteNodeData {
  text: string;
  color?: StickyNoteColor;
  fontSize?: number;
  showHandles?: boolean;
  isDarkMode?: boolean;
  onTextChange?: (id: string, text: string) => void;
}

const COLOR_MAP: Record<StickyNoteColor, { bg: string; fold: string; text: string }> = {
  yellow: { bg: '#fef9c3', fold: '#fde047', text: '#713f12' },
  pink: { bg: '#fce7f3', fold: '#f9a8d4', text: '#831843' },
  blue: { bg: '#dbeafe', fold: '#93c5fd', text: '#1e3a8a' },
  green: { bg: '#dcfce7', fold: '#86efac', text: '#14532d' },
  purple: { bg: '#f3e8ff', fold: '#d8b4fe', text: '#581c87' },
  orange: { bg: '#ffedd5', fold: '#fdba74', text: '#7c2d12' },
};

const StickyNoteNode: React.FC<NodeProps<StickyNoteNodeData>> = (props) => {
  const { id, data, selected } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    text = '',
    color = 'yellow',
    fontSize = 13,
    showHandles = true,
  } = data;

  const colorScheme = COLOR_MAP[color] || COLOR_MAP.yellow;

  // Focus textarea when editing starts (only on initial edit, not on every keystroke)
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]); // Remove editValue from deps - we only want this on edit start

  // Auto-resize textarea as content changes
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing, editValue]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(text);
  };

  const handleBlur = () => {
    if (editValue !== text && data.onTextChange) {
      data.onTextChange(id, editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // CRITICAL: Stop propagation so ReactFlow doesn't capture keyboard events
    e.stopPropagation();
    
    if (e.key === 'Escape') {
      setEditValue(text);
      setIsEditing(false);
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleBlur();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  // Stop all keyboard/mouse events from bubbling to ReactFlow
  const stopPropagation = (e: React.KeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className={styles.stickyContainer}
      style={{ 
        backgroundColor: colorScheme.bg,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Resize handles when selected */}
      {selected && (
        <NodeResizer
          minWidth={100}
          minHeight={80}
          keepAspectRatio={false}
        />
      )}

      {/* Folded corner effect */}
      <div 
        className={styles.foldedCorner}
        style={{ 
          borderTopColor: colorScheme.fold,
          borderRightColor: colorScheme.bg,
        }}
      />

      {/* Connection handles - both source and target at each position */}
      {showHandles && (
        <>
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
        </>
      )}

      {/* Content */}
      <div className={styles.content}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onKeyUp={stopPropagation}
            onMouseDown={stopPropagation}
            onClick={stopPropagation}
            className={`${styles.textarea} nodrag nowheel nopan`}
            style={{ 
              color: colorScheme.text,
              fontSize: `${fontSize}px`,
            }}
            placeholder="Add note..."
          />
        ) : (
          <div 
            className={styles.text}
            style={{ 
              color: colorScheme.text,
              fontSize: `${fontSize}px`,
            }}
          >
            {text || 'Double-click to add note'}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(StickyNoteNode);
