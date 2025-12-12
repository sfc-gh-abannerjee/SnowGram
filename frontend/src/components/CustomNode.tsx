/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */
import React, { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import styles from './CustomNode.module.css';

interface CustomNodeData {
  label: string;
  icon: string;
  componentType: string;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  isDarkMode?: boolean;
  background?: string;
  borderRadius?: number;
  fillColor?: string;
  fillAlpha?: number;
  showHandles?: boolean;
}

const CustomNode: React.FC<NodeProps<CustomNodeData>> = (props) => {
  const { id, data, selected } = props;
  const style = (props as any).style as React.CSSProperties | undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBoundary = data.componentType?.startsWith('account_boundary');
  const labelColor = (data as any)?.labelColor || (style as any)?.color;
  // Force dark grey for nodes in dark mode, white for light mode
  const bgFallback = data.isDarkMode ? '#1e3a4a' : '#ffffff';
  
  // For boundaries, ALWAYS use the style.background (which has the rgba value)
  const boundaryBackground = isBoundary ? (style?.background || 'transparent') : null;
  
  const mergedStyle: React.CSSProperties = {
    ...(style || {}),
    background: boundaryBackground || data.background || style?.background || bgFallback,
    borderRadius: data.borderRadius ?? style?.borderRadius ?? 16,
    border: style?.border,
    color: data.isDarkMode ? '#e5f2ff' : '#0F172A',
  };
  // Boundaries use rgba backgrounds; regular nodes use the provided style/data background only
  const backgroundStyle = isBoundary 
    ? (style?.background || 'rgba(41, 181, 232, 0.08)') // Fallback to snowflake blue with low alpha
    : (mergedStyle.background || bgFallback);

  const surfaceStyle: React.CSSProperties = {
    background: backgroundStyle,
    borderRadius: mergedStyle.borderRadius,
    border: mergedStyle.border,
    boxShadow: mergedStyle.boxShadow,
    overflow: 'visible',
  };

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(data.label);
  };

  const handleBlur = () => {
    if (editValue.trim() && editValue !== data.label) {
      if (typeof data.onRename === 'function') {
        data.onRename(id, editValue.trim());
      }
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      setEditValue(data.label);
      setIsEditing(false);
    }
  };

  return (
    <div 
      className={`${styles.nodeContainer} ${isBoundary ? styles.boundaryNode : ''}`}
      data-dark-mode={data.isDarkMode ? 'true' : 'false'}
      style={{
        ...mergedStyle,
        background: 'transparent',
        boxShadow: 'none',
        padding: 0,
        overflow: 'visible',
      }}
    >
      <div className={styles.nodeSurface} style={surfaceStyle}>
      {/* Resize handles (only show when selected) */}
      {selected && (
        <NodeResizer
          minWidth={120}
          minHeight={100}
          keepAspectRatio={false}
          shouldResize={() => true}
        />
      )}

      {/* Handles on all sides as both sources and targets for cleaner routing */}
      <Handle
        type="source"
        position={Position.Top}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="top-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Top}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="top-target"
        isConnectable
      />
      <Handle
        type="source"
        position={Position.Left}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="left-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Left}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="left-target"
        isConnectable
      />

      {/* Node content */}
      <div className={`${styles.nodeContent} ${isBoundary ? styles.boundaryNodeContent : ''}`}>
        <button
          className={styles.deleteButton}
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete(id);
          }}
          title="Delete node"
        >
          ×
        </button>
        
        {!isBoundary && (
          <div className={styles.iconContainer}>
            <img src={data.icon} alt={data.label} className={styles.icon} />
          </div>
        )}
        
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className={styles.labelInput}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ color: labelColor || undefined }}
          />
        ) : (
          <div 
            className={styles.label}
            onDoubleClick={handleDoubleClick}
            title="Double-click to rename"
            style={{ color: labelColor || undefined }}
          >
            {data.label}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="right-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Right}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="right-target"
        isConnectable
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="bottom-source"
        isConnectable
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`}
        id="bottom-target"
        isConnectable
      />
      </div>
    </div>
  );
};

export default memo(CustomNode);

