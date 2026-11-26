'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export function FormError({ message, children }: { message: string; children?: ReactNode }) {
  const summary = useRef<HTMLDivElement>(null);
  // Focus only when this error is first shown, never while a field is edited.
  useEffect(() => {
    summary.current?.focus();
  }, []);
  return (
    <div className="form-error" role="alert" tabIndex={-1} ref={summary}>
      <CircleAlert size={20} aria-hidden="true" />
      <div>
        <p>{message}</p>
        {children}
      </div>
    </div>
  );
}
