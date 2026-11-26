// PixB UI
import { addToast } from '@/components/ui/primitives';

// Toast config
import { toastIcons } from '@/lib/utils/toastConfig';

// Interfaces
import { Meta, UppyFile, UppyOptions } from '@uppy/core';

// Simple toast deduplication - tracks last shown toast
let lastToast: { key: string; time: number } | null = null;

/* ------------------------------- Uppy logger ------------------------------ */
const debugLogger = {
    debug: (...args: unknown[]) => console.debug(`[Uppy]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[Uppy]`, ...args),
    error: (...args: unknown[]) => console.error(`[Uppy]`, ...args),
  },
  blankLogger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
  };

/* ------------------------------- Uppy config ------------------------------ */
export const uppyConfig: UppyOptions<Meta, Record<string, never>> = {
  autoProceed: false,
  logger: process.env.NODE_ENV === 'development' ? debugLogger : blankLogger,
  onBeforeFileAdded: (file: UppyFile<Meta, Record<string, never>>) => {
    // Set a random ID to prevent duplicates
    file.id = `pixb-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    return file;
  },
  restrictions: {
    allowedFileTypes: null,
    minFileSize: 0,
    maxFileSize: 0,
    maxTotalFileSize: Infinity,
    minNumberOfFiles: 1,
    maxNumberOfFiles: Infinity,
    requiredMetaFields: [],
  },
};

/* -------------------------------- FUNCTIONS ------------------------------- */
/**
 * Shows a toast notification with deduplication.
 * @param title - The title of the toast.
 * @param status - The status of the toast.
 * @param description - The description of the toast.
 */
export const showToast = (
  title: string,
  status?: 'default' | 'foreground' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger',
  description?: string,
): void => {
  const now = Date.now();
  const toastKey = `${title}|${status || 'default'}|${description || ''}`;

  // Check if the same toast was shown recently (within 2 seconds)
  if (lastToast && lastToast.key === toastKey && now - lastToast.time < 2000) {
    return; // Don't show duplicate toast
  }

  // Show the toast and remember it
  addToast({
    title: title,
    description: description,
    color: status,
    icon: toastIcons[status || 'default'],
  });

  lastToast = { key: toastKey, time: now };
};
