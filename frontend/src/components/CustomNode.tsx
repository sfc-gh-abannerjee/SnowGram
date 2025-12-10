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
}

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ id, data, selected, style }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBoundary = data.componentType?.startsWith('account_boundary');
  const mergedStyle: React.CSSProperties = {
    ...(style || {}),
    background: data.background ?? style?.background,
    borderRadius: data.borderRadius ?? style?.borderRadius,
    border: style?.border,
  };
  const backgroundStyle = isBoundary ? mergedStyle.background || 'transparent' : mergedStyle.background;

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
      data.onRename(id, editValue.trim());
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
      style={mergedStyle}
    >
      {/* Resize handles (only show when selected) */}
      {selected && (
        <NodeResizer
          minWidth={120}
          minHeight={100}
          keepAspectRatio={false}
          shouldResize={() => true}
        />
      )}

      {/* All handles are type="source" - connectionMode="loose" allows any-to-any connections */}
      <Handle 
        type="source" 
        position={Position.Top} 
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`} 
        id="top"
        isConnectable={true}
      />
      <Handle 
        type="source" 
        position={Position.Left} 
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`} 
        id="left"
        isConnectable={true}
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
          />
        ) : (
          <div 
            className={styles.label}
            onDoubleClick={handleDoubleClick}
            title="Double-click to rename"
          >
            {data.label}
          </div>
        )}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`} 
        id="right"
        isConnectable={true}
      />
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className={`${styles.handle} ${(!selected && !data.showHandles) ? styles.handleHidden : ''}`} 
        id="bottom"
        isConnectable={true}
      />
    </div>
  );
};

export default memo(CustomNode);

