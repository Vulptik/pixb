'use client';

import { ErrorState, type ErrorStateProps } from '@/components/shelf/ErrorState';

export default function AccountError({ error, reset }: ErrorStateProps) {
  return <ErrorState error={error} reset={reset} variant="account" />;
}
