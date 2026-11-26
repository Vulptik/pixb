'use client';

import { createContext, useContext } from 'react';

type PortalContainerContextType = HTMLElement | null;

const PortalContainerContext = createContext<PortalContainerContextType>(null);

export const usePortalContainer = (): PortalContainerContextType => {
  return useContext(PortalContainerContext);
};
