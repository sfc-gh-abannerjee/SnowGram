/**
 * TabBar Component - Lucidchart-style multi-tab interface
 * 
 * Features:
 * - Horizontal scrollable tab strip
 * - Drag-to-reorder tabs
 * - Double-click to rename (inline edit)
 * - Close button on hover
 * - Dirty indicator for unsaved changes
 * - Context menu (right-click)
 * - Keyboard shortcuts
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDiagramTabsStore } from '../store/diagramTabsStore';
import styles from './TabBar.module.css';

interface TabBarProps {
  isDarkMode?: boolean;
  onTabSwitch?: (tabId: string) => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string | null;
}

export const TabBar: React.FC<TabBarProps> = ({ isDarkMode = false, onTabSwitch }) => {
  const {
    tabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    renameTab,
    duplicateTab,
    reorderTabs,
  } = useDiagramTabsStore();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: null,
  });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  // Handle tab click
  const handleTabClick = useCallback((tabId: string) => {
    if (editingId === tabId) return; // Don't switch while editing
    
    if (tabId !== activeTabId) {
      onTabSwitch?.(tabId);
      switchTab(tabId);
    }
  }, [activeTabId, editingId, onTabSwitch, switchTab]);

  // Handle double-click to rename
  const handleDoubleClick = useCallback((tabId: string) => {
    setEditingId(tabId);
  }, []);

  // Handle rename completion
  const handleRenameComplete = useCallback((tabId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (trimmedName) {
      renameTab(tabId, trimmedName);
    }
    setEditingId(null);
  }, [renameTab]);

  // Handle close button click
  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    
    // Check if tab has unsaved changes
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.isDirty) {
      const confirmed = window.confirm(
        `"${tab.name}" has unsaved changes. Close anyway?`
      );
      if (!confirmed) return;
    }
    
    closeTab(tabId);
  }, [closeTab, tabs]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }, []);

  // Context menu actions
  const handleContextAction = useCallback((action: string) => {
    const { tabId } = contextMenu;
    if (!tabId) return;
    
    switch (action) {
      case 'rename':
        setEditingId(tabId);
        break;
      case 'duplicate':
        duplicateTab(tabId);
        break;
      case 'close':
        closeTab(tabId);
        break;
      case 'closeOthers':
        tabs.forEach(tab => {
          if (tab.id !== tabId) {
            closeTab(tab.id);
          }
        });
        break;
    }
    
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, [closeTab, contextMenu, duplicateTab, tabs]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTabId(null);
    setDragOverTabId(null);
    setDragOverSide(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (tabId === draggedTabId) return;
    
    // Determine if dragging to left or right half of tab
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const side = e.clientX < midpoint ? 'left' : 'right';
    
    setDragOverTabId(tabId);
    setDragOverSide(side);
  }, [draggedTabId]);

  const handleDragLeave = useCallback(() => {
    setDragOverTabId(null);
    setDragOverSide(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    
    if (!draggedTabId || draggedTabId === targetTabId) return;
    
    const fromIndex = tabs.findIndex(t => t.id === draggedTabId);
    let toIndex = tabs.findIndex(t => t.id === targetTabId);
    
    // Adjust toIndex based on drop side
    if (dragOverSide === 'right') {
      toIndex = toIndex + 1;
    }
    
    // Adjust for the fact that removing the dragged item shifts indices
    if (fromIndex < toIndex) {
      toIndex = toIndex - 1;
    }
    
    if (fromIndex !== toIndex) {
      reorderTabs(fromIndex, toIndex);
    }
    
    handleDragEnd();
  }, [draggedTabId, dragOverSide, handleDragEnd, reorderTabs, tabs]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + T: New tab
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        createTab();
      }
      // Ctrl/Cmd + W: Close tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, closeTab, createTab]);

  // Build tab class names
  const getTabClassName = (tabId: string, isActive: boolean) => {
    const classes = [styles.tab];
    if (isActive) classes.push(styles.active);
    if (tabId === draggedTabId) classes.push(styles.dragging);
    if (tabId === dragOverTabId) {
      classes.push(dragOverSide === 'left' ? styles.dragOver : styles.dragOverRight);
    }
    return classes.join(' ');
  };

  return (
    <>
      <div
        ref={tabBarRef}
        className={`${styles.tabBar} ${isDarkMode ? styles.darkMode : ''}`}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={getTabClassName(tab.id, tab.id === activeTabId)}
            onClick={() => handleTabClick(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            draggable={editingId !== tab.id}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tab.id)}
            title={tab.name}
          >
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                type="text"
                className={styles.tabNameInput}
                defaultValue={tab.name}
                onBlur={(e) => handleRenameComplete(tab.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRenameComplete(tab.id, e.currentTarget.value);
                  }
                  if (e.key === 'Escape') {
                    setEditingId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className={styles.tabName}>{tab.name}</span>
                {tab.isDirty && <span className={styles.dirtyIndicator}>•</span>}
              </>
            )}
            {tabs.length > 1 && (
              <button
                className={styles.closeBtn}
                onClick={(e) => handleCloseClick(e, tab.id)}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        
        <button
          className={styles.addTab}
          onClick={() => createTab()}
          title="New tab (Ctrl+T)"
        >
          +
        </button>
      </div>
      
      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className={`${styles.contextMenu} ${isDarkMode ? styles.darkMode : ''}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => handleContextAction('rename')}
          >
            <svg className={styles.contextMenuIcon} viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Rename
          </button>
          <button
            className={styles.contextMenuItem}
            onClick={() => handleContextAction('duplicate')}
          >
            <svg className={styles.contextMenuIcon} viewBox="0 0 20 20" fill="currentColor">
              <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
              <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
            </svg>
            Duplicate
          </button>
          <div className={styles.contextMenuDivider} />
          <button
            className={styles.contextMenuItem}
            onClick={() => handleContextAction('close')}
          >
            <svg className={styles.contextMenuIcon} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Close
          </button>
          {tabs.length > 1 && (
            <button
              className={styles.contextMenuItem}
              onClick={() => handleContextAction('closeOthers')}
            >
              <svg className={styles.contextMenuIcon} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
              Close Others
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default TabBar;
