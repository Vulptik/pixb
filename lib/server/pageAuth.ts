import { cache } from 'react';
import { getAuthFromRequest } from '@/lib/server/auth';

// React scopes this memoization to one server render, never across users.
export const getPageAuth = cache(() => getAuthFromRequest());
