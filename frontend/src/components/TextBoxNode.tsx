/**
 * TextBoxNode - Pure text annotation node for diagrams
 * 
 * Features:
 * - Inline text editing on double-click
 * - Customizable font size, color, alignment
 * - Optional border
 * - Optional connection handles
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import styles from './TextBoxNode.module.css';

export interface TextBoxNodeData {
  text: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  showBorder?: boolean;
  showHandles?: boolean;
  isDarkMode?: boolean;
  onTextChange?: (id: string, text: string) => void;
}

const TextBoxNode: React.FC<NodeProps<TextBoxNodeData>> = (props) => {
  const { id, data, selected } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    fontSize = 14,
    fontWeight = 'normal',
    textAlign = 'left',
    textColor,
    backgroundColor,
    borderColor,
    borderWidth = 1,
    showBorder = false,
    showHandles = true,
    isDarkMode = false,
  } = data;

  // Default colors based on dark mode
  const defaultTextColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const defaultBgColor = isDarkMode ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.95)';
  const defaultBorderColor = isDarkMode ? '#475569' : '#cbd5e1';

  const containerStyle: React.CSSProperties = {
    backgroundColor: backgroundColor || defaultBgColor,
    border: showBorder 
      ? `${borderWidth}px solid ${borderColor || defaultBorderColor}` 
      : 'none',
    color: textColor || defaultTextColor,
  };

  const textStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    fontWeight,
    textAlign,
    color: textColor || defaultTextColor,
  };

  // Focus textarea when editing starts (only on initial edit, not on every keystroke)
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Only select on initial open
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
    setEditValue(data.text || '');
  };

  const handleBlur = () => {
    if (editValue !== data.text && data.onTextChange) {
      data.onTextChange(id, editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // CRITICAL: Stop propagation so ReactFlow doesn't capture keyboard events
    e.stopPropagation();
    
    if (e.key === 'Escape') {
      setEditValue(data.text || '');
      setIsEditing(false);
    }
    // Allow Enter for newlines, use Cmd/Ctrl+Enter to confirm
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleBlur();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  // Stop all keyboard events from bubbling to ReactFlow
  const stopPropagation = (e: React.KeyboardEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className={`${styles.textBoxContainer} ${isDarkMode ? styles.darkMode : ''}`}
      style={containerStyle}
      onDoubleClick={handleDoubleClick}
    >
      {/* Resize handles when selected */}
      {selected && (
        <NodeResizer
          minWidth={80}
          minHeight={40}
          keepAspectRatio={false}
        />
      )}

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
            style={textStyle}
            placeholder="Enter text..."
          />
        ) : (
          <div 
            className={styles.text}
            style={textStyle}
          >
            {data.text || 'Double-click to edit'}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(TextBoxNode);
