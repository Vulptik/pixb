'use client';
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, RotateCw, X } from 'lucide-react';
import type Uppy from '@uppy/core';
import { MotionList, MotionPresence } from '@/components/ui/MotionPresence';
import { addToast, ToastProvider, type ToastColor } from '@/components/ui/primitives';
import UserContext from '@/lib/contexts/UserContext';
import type { QuotaType, UserResponseType } from '@/types';
import { shelfApi } from './api';

const UPLOAD_QUEUE_DISMISS_MS = 2000;

type QueueItem = {
  id: string;
  name: string;
  progress: number;
  error: string | null;
  complete: boolean;
  size: number;
};
type UploadContext = {
  dragging: boolean;
  choose: (collection?: string) => void;
  revision: number;
  refresh: () => void;
  notify: (message: string, color?: ToastColor) => void;
  quota: QuotaType | null;
  pendingBytes: number;
  pendingFileCount: number;
  quotaError: boolean;
  quotaIssue: boolean;
  dismissQuotaIssue: () => void;
  refreshQuota: () => Promise<void>;
};
const Context = createContext<UploadContext | null>(null);
export function useShelfUploads() {
  const value = useContext(Context);
  if (!value) throw new Error('ShelfUploads is required');
  return value;
}
export function ShelfUploads({ children }: { children: React.ReactNode }) {
  const t = useTranslations('shelf'),
    path = usePathname();
  const user = useContext(UserContext);
  const userId = user.data?.id;
  const input = useRef<HTMLInputElement>(null),
    clearButton = useRef<HTMLButtonElement>(null),
    collection = useRef<string | undefined>(undefined),
    uppy = useRef<Uppy | null>(null),
    init = useRef<Promise<Uppy> | null>(null),
    mounted = useRef(true),
    dragDepth = useRef(0),
    revisionRef = useRef(0),
    quotaRequest = useRef(0),
    completedFiles = useRef(new Set<string>()),
    additions = useRef(Promise.resolve());
  const [queue, setQueue] = useState<QueueItem[]>([]),
    [revision, setRevision] = useState(0),
    [dragging, setDragging] = useState(false),
    [storage, setStorage] = useState({
      quota: user.data?.attributes.quota ?? null,
      savedBytes: 0,
    }),
    [quotaError, setQuotaError] = useState(false),
    [quotaIssue, setQuotaIssue] = useState(false);
  const pathRef = useRef(path);
  const getClearButton = useCallback(() => clearButton.current, []);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  const refresh = useCallback(() => {
    // Invalidate responses immediately, including ones completing before the next effect.
    quotaRequest.current++;
    revisionRef.current++;
    setRevision(revisionRef.current);
  }, []);
  const refreshQuota = useCallback(async () => {
    if (!userId) return;
    const request = ++quotaRequest.current;
    try {
      const result = await shelfApi<UserResponseType>('/api/v1/user', { cache: 'no-store' });
      if (!mounted.current || request !== quotaRequest.current) return;
      setStorage({ quota: result.attributes.quota, savedBytes: 0 });
      setQuotaError(false);
    } catch {
      if (mounted.current && request === quotaRequest.current) setQuotaError(true);
    }
  }, [userId]);
  useEffect(() => {
    void refreshQuota();
  }, [revision, refreshQuota]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshQuota();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshQuota]);
  const notify = useCallback(
    (title: string, color: ToastColor = 'success') => addToast({ title, color }),
    [],
  );
  const ensure = useCallback(async () => {
    if (uppy.current) return uppy.current;
    if (init.current) return init.current;
    init.current = (async () => {
      const [{ default: UppyClass }, { default: Tus }] = await Promise.all([
        import('@uppy/core'),
        import('@uppy/tus'),
      ]);
      const instance = new UppyClass({
        autoProceed: true,
        allowMultipleUploadBatches: true,
        onBeforeFileAdded(file, files) {
          // TUS fingerprints include the account, destination, and copy number
          // so repeated selections can upload independently.
          const baseId = `pixb:${userId ?? ''}:${file.meta.collection || ''}:${file.id}`;
          let id = baseId;
          for (let copy = 2; files[id]; copy++) id = `${baseId}:${copy}`;
          return { ...file, id };
        },
      });
      instance.use(Tus, {
        endpoint: '/files',
        withCredentials: true,
        chunkSize: 10 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        removeFingerprintOnSuccess: true,
        allowedMetaFields: ['name', 'type', 'filename', 'filetype', 'collection'],
      });
      const sync = () => {
        if (!mounted.current) return;
        setQueue(
          instance.getFiles().map((f) => ({
            id: f.id,
            name: f.name || '',
            progress: f.progress.percentage || 0,
            error: f.error ? String(f.error) : null,
            complete: !!f.progress.uploadComplete,
            size: f.size ?? 0,
          })),
        );
      };
      instance.on('file-added', sync);
      instance.on('file-removed', (file) => {
        if (file) completedFiles.current.delete(file.id);
        sync();
      });
      instance.on('upload-progress', sync);
      instance.on('upload-error', sync);
      instance.on('upload-retry', sync);
      instance.on('upload-success', () => {
        let savedBytes = 0;
        for (const file of instance.getFiles()) {
          if (file.progress.uploadComplete && !file.error && !completedFiles.current.has(file.id)) {
            completedFiles.current.add(file.id);
            savedBytes += file.size ?? 0;
          }
        }
        // Keep saved bytes in the quota preview even if the queue closes before it refreshes.
        if (savedBytes) {
          setStorage((current) => ({ ...current, savedBytes: current.savedBytes + savedBytes }));
        }
        sync();
        refresh();
      });
      if (!mounted.current) {
        instance.destroy();
        throw new Error('Upload provider closed');
      }
      uppy.current = instance;
      return instance;
    })();
    try {
      return await init.current;
    } finally {
      init.current = null;
    }
  }, [refresh, userId]);
  const checkSelection = useCallback(
    async (instance: Uppy, sizes: number[]) => {
      const size = sizes.reduce((total, value) => total + value, 0);
      // The server remains authoritative. Unlimited accounts need no quota preflight.
      if (!size || !storage.quota || storage.quota.unlimited) return true;
      const pending = instance
        .getFiles()
        .filter((file) => !file.progress.uploadComplete && !file.error)
        .reduce((total, file) => total + (file.size ?? 0), 0);
      const result = await shelfApi<{ allowed: boolean; code?: string }>(
        '/api/v1/user/check_quota',
        {
          method: 'POST',
          body: JSON.stringify({
            size: size + pending,
            largestFileSize: sizes.reduce((largest, value) => Math.max(largest, value), 0),
          }),
        },
      );
      if (result.allowed) return true;
      if (result.code === 'quota_exceeded') setQuotaIssue(true);
      else notify(t(result.code === 'file_too_large' ? 'fileTooLarge' : 'uploadFailed'), 'danger');
      void refreshQuota();
      return false;
    },
    [storage.quota, refreshQuota, t, notify],
  );
  const add = useCallback(
    (files: File[], target?: string) => {
      // Serialize overlapping picker/drop/paste selections so each preflight sees the preceding batch.
      additions.current = additions.current.then(async () => {
        if (!files.length || !mounted.current) return;
        setQuotaIssue(false);
        try {
          const instance = await ensure();
          if (
            !mounted.current ||
            !(await checkSelection(
              instance,
              files.map((file) => file.size),
            ))
          )
            return;
          if (!mounted.current) return;
          for (const file of files) {
            try {
              instance.addFile({
                name: file.name,
                type: file.type,
                data: file,
                meta: {
                  filename: file.name,
                  filetype: file.type,
                  // Uppy stringifies every allowed field, including missing values.
                  collection: target ?? '',
                },
              });
            } catch {
              notify(t('uploadRejected'), 'danger');
            }
          }
        } catch {
          if (mounted.current) notify(t('uploadFailed'), 'danger');
        }
      });
      return additions.current;
    },
    [ensure, checkSelection, t, notify],
  );
  const retry = async (id: string) => {
    additions.current = additions.current.then(async () => {
      try {
        const instance = uppy.current;
        const file = instance?.getFile(id);
        if (!instance || !file) return;
        setQuotaIssue(false);
        if ((await checkSelection(instance, [file.size ?? 0])) && mounted.current) {
          // Serialize quota preflight/start, not the lifetime of the transfer.
          void instance.retryUpload(id).catch(() => {
            if (mounted.current) notify(t('uploadFailed'), 'danger');
          });
        }
      } catch {
        if (mounted.current) notify(t('uploadFailed'), 'danger');
      }
    });
    return additions.current;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      quotaRequest.current++;
      uppy.current?.destroy();
      uppy.current = null;
    };
  }, []);
  useEffect(() => {
    const activeCollection = () => /^\/collections\/(\d+)$/.exec(pathRef.current)?.[1];
    const internalDragType = 'application/x-pixb-internal-drag';
    const isInternalDrag = (e: DragEvent) => e.dataTransfer?.types?.includes(internalDragType);
    // Browsers can expose dragged page images as Files, just like an OS drop.
    // Mark their origin on the drag itself so cancellation cannot leave stale state.
    const start = (e: DragEvent) => {
      if (!e.defaultPrevented) e.dataTransfer?.setData(internalDragType, '1');
    };
    const resetDrag = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files') && !isInternalDrag(e)) {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = isInternalDrag(e) ? 'none' : 'copy';
      }
    };
    const leave = () => {
      if (dragDepth.current > 0 && --dragDepth.current === 0) resetDrag();
    };
    const drop = (e: DragEvent) => {
      resetDrag();
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      if (isInternalDrag(e)) return;
      void add(Array.from(e.dataTransfer.files), activeCollection());
    };
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        void add(files, activeCollection());
      }
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragenter', enter);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    document.addEventListener('dragend', resetDrag);
    window.addEventListener('blur', resetDrag);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragenter', enter);
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
      document.removeEventListener('dragend', resetDrag);
      window.removeEventListener('blur', resetDrag);
      document.removeEventListener('paste', paste);
    };
  }, [add]);
  useEffect(() => {
    const instance = uppy.current;
    if (!instance || !queue.length || queue.some((file) => !file.complete || file.error)) return;
    const timer = setTimeout(() => {
      const files = instance.getFiles();
      if (files.length && files.every((file) => file.progress.uploadComplete && !file.error)) {
        instance.removeFiles(files.map((file) => file.id));
      }
    }, UPLOAD_QUEUE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [queue]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (queue.some((f) => !f.complete && !f.error)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [queue]);
  const pendingFiles = queue.filter((file) => !file.complete && !file.error);
  return (
    <Context.Provider
      value={{
        dragging,
        choose: (id) => {
          collection.current = id;
          input.current?.click();
        },
        revision,
        refresh,
        notify,
        quota: storage.quota,
        pendingBytes: pendingFiles.reduce((total, file) => total + file.size, storage.savedBytes),
        pendingFileCount: pendingFiles.length,
        quotaError,
        quotaIssue,
        dismissQuotaIssue: () => setQuotaIssue(false),
        refreshQuota,
      }}
    >
      {children}
      <input
        hidden
        ref={input}
        type="file"
        multiple
        onChange={(e) => {
          void add(Array.from(e.target.files || []), collection.current);
          e.target.value = '';
        }}
      />
      <span className="sr-only" role="status">
        {dragging ? t('releaseToUpload') : ''}
      </span>
      <MotionPresence
        present={queue.length > 0}
        getExitFocus={() => document.querySelector<HTMLButtonElement>('button.upload-button')}
        className="upload-queue"
        role="complementary"
        aria-label={t('uploads')}
      >
        <header>
          <strong>{t('uploads')}</strong>
          <button
            ref={clearButton}
            className="icon-button"
            aria-label={t('clearCompleted')}
            onClick={() =>
              uppy.current
                ?.getFiles()
                .filter((f) => f.progress.uploadComplete)
                .forEach((f) => uppy.current?.removeFile(f.id))
            }
          >
            <Check size={16} />
          </button>
        </header>
        <div className="upload-queue-list">
          <MotionList items={queue} getKey={(file) => file.id} getExitFocus={getClearButton}>
            {(file) => (
              <div className="queue-item" data-complete={file.complete}>
                <div>
                  <span title={file.name}>{file.name}</span>
                  <small role={file.error ? 'alert' : undefined}>
                    {file.error
                      ? t(
                          /507|storageFull|ENOSPC|EDQUOT/i.test(file.error)
                            ? 'storageFull'
                            : /503|storageUnavailable|EROFS|EACCES|EPERM/i.test(file.error)
                              ? 'storageUnavailable'
                              : /quota/i.test(file.error)
                                ? 'quotaExceeded'
                                : /413|limit|too large/i.test(file.error)
                                  ? 'fileTooLarge'
                                  : /type not allowed/i.test(file.error)
                                    ? 'fileTypeNotAllowed'
                                    : 'uploadFailed',
                        )
                      : file.complete
                        ? t('saved')
                        : t('uploadProgress', { percent: Math.round(file.progress) })}
                  </small>
                  <progress max={100} value={file.progress} aria-label={file.name} />
                </div>
                {file.error && (
                  <button
                    className="icon-button"
                    aria-label={t('retry')}
                    onClick={() => void retry(file.id)}
                  >
                    <RotateCw size={15} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={t(file.complete ? 'dismiss' : 'cancelUpload')}
                  onClick={() => uppy.current?.removeFile(file.id)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </MotionList>
        </div>
      </MotionPresence>
      <ToastProvider />
    </Context.Provider>
  );
}
