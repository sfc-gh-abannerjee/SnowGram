/**
 * Zustand Store for Multi-Tab Diagram Management
 * 
 * Manages multiple diagram tabs with Lucidchart-style UX:
 * - Each tab has its own nodes, edges, viewport, and chat context
 * - State persisted via storage adapter (works across desktop/SPCS/Native App)
 * - Integrates with ReactFlow for canvas state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Node, Edge, Viewport } from 'reactflow';
import { createStorageAdapter } from '../lib/storageAdapter';

/**
 * Represents a single diagram tab
 */
export interface DiagramTab {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  threadId: number | null;      // Per-tab conversation context for agent
  lastMessageId: number | null; // Last message ID for conversation continuity
  lastModified: string;
  isDirty: boolean;
}

/**
 * Tab store state and actions
 */
interface DiagramTabsState {
  tabs: DiagramTab[];
  activeTabId: string | null;
  
  // Tab lifecycle actions
  createTab: (name?: string) => string;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  duplicateTab: (id: string) => string | null;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  
  // State sync with ReactFlow
  updateTabContent: (id: string, nodes: Node[], edges: Edge[]) => void;
  updateTabViewport: (id: string, viewport: Viewport) => void;
  updateTabChat: (id: string, threadId: number | null, lastMessageId: number | null) => void;
  markTabClean: (id: string) => void;
  markTabDirty: (id: string) => void;
  
  // Computed accessors
  getActiveTab: () => DiagramTab | null;
  getTabById: (id: string) => DiagramTab | null;
}

/**
 * Generate a unique tab ID
 */
function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new empty tab
 */
function createEmptyTab(name: string = 'Untitled'): DiagramTab {
  return {
    id: generateTabId(),
    name,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    threadId: null,
    lastMessageId: null,
    lastModified: new Date().toISOString(),
    isDirty: false,
  };
}

/**
 * Zustand store with persistence middleware
 */
export const useDiagramTabsStore = create<DiagramTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      
      /**
       * Create a new tab and make it active
       */
      createTab: (name = 'Untitled') => {
        const newTab = createEmptyTab(name);
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));
        return newTab.id;
      },
      
      /**
       * Switch to a different tab
       */
      switchTab: (id) => {
        const { tabs } = get();
        const exists = tabs.some(t => t.id === id);
        if (exists) {
          set({ activeTabId: id });
        }
      },
      
      /**
       * Close a tab
       * If closing the active tab, switch to adjacent tab
       */
      closeTab: (id) => {
        const { tabs, activeTabId } = get();
        
        // Don't close the last tab
        if (tabs.length <= 1) {
          return;
        }
        
        const tabIndex = tabs.findIndex(t => t.id === id);
        if (tabIndex === -1) return;
        
        const newTabs = tabs.filter(t => t.id !== id);
        let newActiveId = activeTabId;
        
        // If closing active tab, switch to adjacent
        if (activeTabId === id) {
          if (tabIndex < newTabs.length) {
            newActiveId = newTabs[tabIndex].id;
          } else {
            newActiveId = newTabs[newTabs.length - 1].id;
          }
        }
        
        set({
          tabs: newTabs,
          activeTabId: newActiveId,
        });
      },
      
      /**
       * Rename a tab
       */
      renameTab: (id, name) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id
              ? { ...tab, name, lastModified: new Date().toISOString() }
              : tab
          ),
        }));
      },
      
      /**
       * Duplicate a tab (creates a copy with new ID)
       */
      duplicateTab: (id) => {
        const { tabs } = get();
        const sourceTab = tabs.find(t => t.id === id);
        if (!sourceTab) return null;
        
        const newTab: DiagramTab = {
          ...sourceTab,
          id: generateTabId(),
          name: `${sourceTab.name} (Copy)`,
          threadId: null,        // New conversation for duplicated tab
          lastMessageId: null,
          lastModified: new Date().toISOString(),
          isDirty: true,
        };
        
        // Insert after the source tab
        const sourceIndex = tabs.findIndex(t => t.id === id);
        const newTabs = [...tabs];
        newTabs.splice(sourceIndex + 1, 0, newTab);
        
        set({
          tabs: newTabs,
          activeTabId: newTab.id,
        });
        
        return newTab.id;
      },
      
      /**
       * Reorder tabs (for drag-and-drop)
       */
      reorderTabs: (fromIndex, toIndex) => {
        const { tabs } = get();
        if (fromIndex < 0 || fromIndex >= tabs.length) return;
        if (toIndex < 0 || toIndex >= tabs.length) return;
        
        const newTabs = [...tabs];
        const [movedTab] = newTabs.splice(fromIndex, 1);
        newTabs.splice(toIndex, 0, movedTab);
        
        set({ tabs: newTabs });
      },
      
      /**
       * Update tab content (nodes and edges)
       */
      updateTabContent: (id, nodes, edges) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id
              ? {
                  ...tab,
                  nodes,
                  edges,
                  lastModified: new Date().toISOString(),
                  isDirty: true,
                }
              : tab
          ),
        }));
      },
      
      /**
       * Update tab viewport (canvas position and zoom)
       */
      updateTabViewport: (id, viewport) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id ? { ...tab, viewport } : tab
          ),
        }));
      },
      
      /**
       * Update tab chat context (for conversation continuity)
       */
      updateTabChat: (id, threadId, lastMessageId) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id ? { ...tab, threadId, lastMessageId } : tab
          ),
        }));
      },
      
      /**
       * Mark tab as clean (saved)
       */
      markTabClean: (id) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id ? { ...tab, isDirty: false } : tab
          ),
        }));
      },
      
      /**
       * Mark tab as dirty (unsaved changes)
       */
      markTabDirty: (id) => {
        set((state) => ({
          tabs: state.tabs.map(tab =>
            tab.id === id ? { ...tab, isDirty: true } : tab
          ),
        }));
      },
      
      /**
       * Get the currently active tab
       */
      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find(t => t.id === activeTabId) || null;
      },
      
      /**
       * Get a tab by ID
       */
      getTabById: (id) => {
        const { tabs } = get();
        return tabs.find(t => t.id === id) || null;
      },
    }),
    {
      name: 'snowgram-diagram-tabs',
      storage: createJSONStorage(() => createStorageAdapter()),
      // Only persist tabs and activeTabId (not functions)
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);

/**
 * Hook to initialize tabs store with a default tab if empty
 * Call this in App.tsx useEffect
 */
export function useInitializeTabs() {
  const { tabs, createTab } = useDiagramTabsStore();
  
  if (typeof window !== 'undefined' && tabs.length === 0) {
    createTab('Untitled');
  }
}
