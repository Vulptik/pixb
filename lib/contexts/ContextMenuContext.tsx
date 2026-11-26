/**
 * ContextMenu context for managing global context menu state
 */

'use client';

import { createContext, useContext } from 'react';

// Types
interface ContextMenuContextType {
  isContextMenuOpen: boolean;
  setIsContextMenuOpen: (isOpen: boolean) => void;
}

const ContextMenuContext = createContext<ContextMenuContextType | null>(null);

export const useContextMenu = () => {
  const context = useContext(ContextMenuContext);
  if (!context) {
    // Return default values instead of throwing error
    return {
      isContextMenuOpen: false,
      setIsContextMenuOpen: () => {},
    };
  }
  return context;
};
