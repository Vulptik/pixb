/**
 * UserProvider component for managing user authentication state and session.
 */

'use client';

// React
import { FC, JSX, useState, useCallback, useMemo } from 'react';

// Actions
import { serverLogout } from '@/lib/actions/auth';

// Context
import userContext from '@/lib/contexts/UserContext';

// Types
import { UserProviderProps } from '@/types';
import { UserResponseType } from '@/types';

const useUser = (initialUser: UserResponseType | null | undefined) => {
  const [data, setData] = useState<UserResponseType | null>(initialUser ?? null);

  const isLogged: () => boolean = useCallback((): boolean => {
    return data?.id ? true : false;
  }, [data]);

  const update: (newData: UserResponseType) => void = useCallback(
    (newData: UserResponseType): void => {
      setData((prev) => (prev === newData ? prev : newData));
    },
    [],
  );

  const clear: () => void = useCallback((): void => {
    setData(null);
  }, []);

  const logout: () => void = useCallback((): void => {
    // Handle server logout asynchronously
    void (async () => {
      try {
        await serverLogout(); // server-side
        if (typeof window !== 'undefined') {
          await window.fetch('/auth/logout', { method: 'POST' }); // client-side
        }
        setData(null);
      } catch (error) {
        console.error('Server logout failed:', error);
        setData(null);
      }
    })();
  }, []);

  return { data, update, clear, logout, isLogged };
};

const UserProvider: FC<UserProviderProps> = ({ children, initialUser }): JSX.Element => {
  const userState = useUser(initialUser);
  const { data, update, clear, logout, isLogged } = userState;

  const contextValue = useMemo(
    () => ({ data, update, isLogged, logout, clear }),
    [clear, data, isLogged, logout, update],
  );

  return <userContext.Provider value={contextValue}>{children}</userContext.Provider>;
};

export default UserProvider;
