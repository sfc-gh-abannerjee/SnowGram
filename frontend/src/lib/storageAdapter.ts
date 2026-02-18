/**
 * Storage Adapter for Multi-Environment Persistence
 * 
 * Provides a unified Storage interface that works across:
 * - Desktop (localStorage)
 * - SPCS deployment (Snowflake API)
 * - Native App (consumer account storage)
 */

export type StorageMode = 'local' | 'spcs' | 'native-app';

interface StorageAdapter extends Storage {
  mode: StorageMode;
}

/**
 * Detect the current storage mode based on environment
 */
function detectStorageMode(): StorageMode {
  if (typeof window === 'undefined') return 'local';
  
  // Native App detection (injected by Snowflake container)
  if ((window as unknown as { __SNOWFLAKE_NATIVE_APP__?: boolean }).__SNOWFLAKE_NATIVE_APP__) {
    return 'native-app';
  }
  
  // SPCS detection (hostname or env var)
  if (
    window.location.hostname.includes('.snowflakecomputing.app') ||
    process.env.NEXT_PUBLIC_STORAGE_MODE === 'spcs'
  ) {
    return 'spcs';
  }
  
  return 'local';
}

/**
 * Queue background sync with Snowflake backend (non-blocking)
 */
async function queueBackendSync(key: string): Promise<void> {
  const mode = detectStorageMode();
  if (mode === 'local') return;
  
  try {
    const response = await fetch('/api/diagram/tabs/load', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.tabs) {
        // Update local cache with server state
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
  } catch (e) {
    console.warn('[StorageAdapter] Background sync failed, using local cache', e);
  }
}

/**
 * Save data to Snowflake backend (for SPCS/Native App)
 */
async function saveToBackend(key: string, value: string): Promise<void> {
  const mode = detectStorageMode();
  if (mode === 'local') return;
  
  try {
    await fetch('/api/diagram/tabs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data: JSON.parse(value) }),
    });
  } catch (e) {
    console.warn('[StorageAdapter] Failed to save to backend, using local cache', e);
  }
}

/**
 * Delete data from Snowflake backend
 */
async function deleteFromBackend(key: string): Promise<void> {
  const mode = detectStorageMode();
  if (mode === 'local') return;
  
  try {
    await fetch(`/api/diagram/tabs/delete?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn('[StorageAdapter] Failed to delete from backend', e);
  }
}

/**
 * Create a storage adapter that works across all environments
 * 
 * For Desktop: Uses localStorage directly
 * For SPCS/Native App: Uses localStorage as cache with async backend sync
 */
export function createStorageAdapter(): StorageAdapter {
  const mode = detectStorageMode();
  
  // For server-side rendering, return a no-op storage
  if (typeof window === 'undefined') {
    return {
      mode: 'local',
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
  }
  
  if (mode === 'local') {
    // Desktop mode: wrap localStorage methods to preserve 'this' binding
    return {
      mode,
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: (key: string) => localStorage.removeItem(key),
      clear: () => localStorage.clear(),
      key: (index: number) => localStorage.key(index),
      get length() { return localStorage.length; },
    };
  }
  
  // SPCS/Native App: localStorage cache with backend sync
  return {
    mode,
    
    getItem: (key: string): string | null => {
      // Return local cache immediately, queue background sync
      const local = localStorage.getItem(key);
      queueBackendSync(key);
      return local;
    },
    
    setItem: (key: string, value: string): void => {
      // Write to local cache first (instant feedback)
      localStorage.setItem(key, value);
      // Then persist to backend (async, non-blocking)
      saveToBackend(key, value);
    },
    
    removeItem: (key: string): void => {
      localStorage.removeItem(key);
      deleteFromBackend(key);
    },
    
    clear: (): void => {
      // Only clear diagram-related keys, not all localStorage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('snowgram-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    },
    
    key: (index: number): string | null => localStorage.key(index),
    
    get length(): number {
      return localStorage.length;
    },
  };
}

/**
 * Get the current storage mode (useful for UI indicators)
 */
export function getStorageMode(): StorageMode {
  return detectStorageMode();
}
