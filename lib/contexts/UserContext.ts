'use client';

// React
import { createContext, Context } from 'react';

// Interfaces
import { UserContextType } from '@/types';

const UserContext: Context<UserContextType> = createContext<UserContextType>({
  data: null,
  isLogged: () => false,
  update: () => {},
  clear: () => {},
  logout: () => {},
});

export default UserContext;
