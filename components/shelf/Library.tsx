'use client';
import { FormError } from '@/components/ui/FormError';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { MotionPresence } from '@/components/ui/MotionPresence';
import { MotionGrid } from '@/components/ui/MotionGrid';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { formatFileSize } from '@/lib/utils/fileSize';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Layers,
  Search,
  Trash2,
  X,
  ArrowDownToLine,
  Pencil,
  Link2,
  Link2Off,
  Plus,
} from 'lucide-react';
import type {
  LibraryFile,
  LibraryCollection,
  LibraryPage,
  InitialLibraryData,
} from '@/types/library';
import { shelfApi, ShelfApiError } from './api';
import { Dialog } from './Dialog';
import { Button } from '@/components/ui/primitives';
import { LibrarySort } from './LibrarySort';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryUploadCard } from './LibraryUploadCard';
import { FileIcon, FileThumbnail } from './FilePreview';
import { ViewerMedia } from './ViewerMedia';
import { MobileLibraryViewer } from './MobileLibraryViewer';
import { useMobileLayout } from '@/lib/hooks/useMobileLayout';
import { useServerHydration } from '@/lib/hooks/useServerHydration';
import { LiquidHeart } from './LiquidHeart';
import { useShelfUploads } from './ShelfUploads';
import { COLLECTION_NAME_MAX_LENGTH } from '@/lib/config/library';
type Action = 'rename' | 'delete' | 'organize' | 'renameCollection' | 'deleteCollection' | null;
export function Library({
  favorites = false,
  collectionId,
  initialData,
}: {
  favorites?: boolean;
  collectionId?: string;
  initialData?: InitialLibraryData;
}) {
  const t = useTranslations('shelf'),
    uploads = useShelfUploads();
  const locale = useLocale();
  const tc = useTranslations('common');
  const router = useRouter();
  const mobile = useMobileLayout();
  const serverHydration = useServerHydration();
  const [files, setFiles] = useState<LibraryFile[]>(initialData?.page.files ?? []),
    [collections, setCollections] = useState<LibraryCollection[]>(initialData?.collections ?? []),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [type, setType] = useState('all'),
    [sharedOnly, setSharedOnly] = useState(false),
    [order, setOrder] = useState<'newest' | 'oldest'>('newest'),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(initialData?.page.total ?? 0),
    [more, setMore] = useState(initialData?.page.hasMore ?? false),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sharingOperation, setSharingOperation] = useState<'copy' | 'revoke' | null>(null),
    [membershipPending, setMembershipPending] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [viewed, setViewed] = useState<LibraryFile | null>(null),
    [deletionTargets, setDeletionTargets] = useState<LibraryFile[]>([]),
    [action, setAction] = useState<Action>(null),
    [name, setName] = useState(''),
    [collectionName, setCollectionName] = useState(''),
    [actionError, setActionError] = useState('');
  const request = useRef(0);
  const initialRequest = useRef(Boolean(initialData) && serverHydration);
  const initialRevalidation = useRef(Boolean(initialData) && !serverHydration);
  const initialContext = useRef({ favorites, collectionId });
  const initialCollections = useRef(Boolean(initialData) && serverHydration);
  const sharingFilter = useRef<HTMLButtonElement>(null);
  const typeFilters = useRef<HTMLDivElement>(null);
  const activeCollection = collections.find((c) => c.id === collectionId);
  useEffect(() => {
    const strip = typeFilters.current;
    const chosen = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !chosen || strip.scrollWidth <= strip.clientWidth) return;
    const start = chosen.offsetLeft;
    const end = start + chosen.offsetWidth;
    const left =
      start < strip.scrollLeft + 8
        ? Math.max(0, start - 8)
        : end > strip.scrollLeft + strip.clientWidth - 20
          ? end - strip.clientWidth + 20
          : strip.scrollLeft;
    strip.scrollTo({
      left,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [type, t]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  const errorText = useCallback(
    (e: unknown) => t(e instanceof ShelfApiError && t.has(e.code) ? e.code : 'requestFailed'),
    [t],
  );
  useEffect(() => {
    if (initialCollections.current && uploads.revision === 0) return;
    initialCollections.current = false;
    let live = true;
    shelfApi<{ collections: LibraryCollection[] }>('/api/v1/collections')
      .then((r) => {
        if (live) setCollections(r.collections);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uploads.revision]);
  useEffect(() => {
    if (
      initialRequest.current &&
      !search &&
      type === 'all' &&
      order === 'newest' &&
      !sharedOnly &&
      uploads.revision === 0 &&
      favorites === initialContext.current.favorites &&
      collectionId === initialContext.current.collectionId
    )
      return () => {
        request.current++;
      };
    initialRequest.current = false;
    const version = ++request.current;
    if (
      !initialRevalidation.current ||
      search ||
      type !== 'all' ||
      order !== 'newest' ||
      sharedOnly
    )
      setLoading(true);
    setError('');
    setSelected([]);
    setPage(1);
    const params = new URLSearchParams({
      q: search,
      type,
      order,
      ...(favorites ? { favorite: 'true' } : {}),
      ...(sharedOnly ? { shared: 'true' } : {}),
      ...(collectionId ? { collection: collectionId } : {}),
    });
    shelfApi<LibraryPage>(`/api/v1/medias?${params}`)
      .then((r) => {
        if (version === request.current) {
          setFiles(r.files);
          setViewed((current) =>
            current ? (r.files.find((file) => file.id === current.id) ?? null) : null,
          );
          setTotal(r.total);
          setMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (version === request.current) {
          setError(errorText(e));
          setFiles([]);
          setViewed(null);
          setMore(false);
        }
      })
      .finally(() => {
        if (version === request.current) {
          initialRevalidation.current = false;
          setLoading(false);
        }
      });
    return () => {
      request.current++;
    };
  }, [search, type, order, favorites, sharedOnly, collectionId, uploads.revision, errorText]);
  async function loadMore() {
    setError('');
    setLoading(true);
    const version = request.current;
    const params = new URLSearchParams({
      q: search,
      type,
      order,
      page: String(page + 1),
      ...(favorites ? { favorite: 'true' } : {}),
      ...(sharedOnly ? { shared: 'true' } : {}),
      ...(collectionId ? { collection: collectionId } : {}),
    });
    try {
      const r = await shelfApi<LibraryPage>(`/api/v1/medias?${params}`);
      if (version === request.current) {
        setFiles((prev) => [...prev, ...r.files.filter((f) => !prev.some((p) => p.id === f.id))]);
        setPage(r.page);
        setMore(r.hasMore);
      }
    } catch (e) {
      if (version === request.current) setError(errorText(e));
    } finally {
      if (version === request.current) setLoading(false);
    }
  }
  function matchesResult(candidate: LibraryFile) {
    return (
      (!favorites || candidate.favorite) &&
      (!sharedOnly || candidate.shared) &&
      candidate.name.toLowerCase().includes(search.trim().slice(0, 255).toLowerCase())
    );
  }
  function replace(file: LibraryFile) {
    const excluded = !matchesResult(file);
    if (excluded && files.some((f) => f.id === file.id)) setTotal((v) => Math.max(0, v - 1));
    setFiles((prev) => prev.map((f) => (f.id === file.id ? file : f)).filter(matchesResult));
    if (excluded) setSelected((prev) => prev.filter((id) => id !== file.id));
    setViewed((prev) => (prev?.id === file.id ? (excluded ? null : file) : prev));
  }
  async function favorite(file: LibraryFile) {
    try {
      const r = await shelfApi<{ file: LibraryFile }>(`/api/v1/medias/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: !file.favorite }),
      });
      replace(r.file);
      if (favorites && !r.file.favorite) uploads.refresh();
    } catch (e) {
      uploads.notify(errorText(e), 'danger');
    }
  }
  async function copy(file: LibraryFile) {
    setBusy(true);
    setSharingOperation('copy');
    try {
      let shareUrl = new URL(file.links.share, window.location.href).href;
      if (!file.shared) {
        const r = await shelfApi<{ file: LibraryFile; shareUrl: string }>(
          `/api/v1/medias/${file.id}/share`,
          { method: 'POST' },
        );
        replace(r.file);
        shareUrl = r.shareUrl;
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        const input = document.createElement('textarea');
        const focused = document.activeElement;
        input.value = shareUrl;
        input.readOnly = true;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        const container = focused instanceof Element ? focused.closest('[role="dialog"]') : null;
        (container || document.body).append(input);
        try {
          input.focus({ preventScroll: true });
          input.select();
          input.setSelectionRange(0, input.value.length);
          if (!document.execCommand('copy')) throw new Error('Copy failed');
        } catch {
          uploads.notify(t('linkCopyFailed'), 'danger');
          return;
        } finally {
          input.remove();
          if (focused instanceof HTMLElement) {
            requestAnimationFrame(() => focused.focus({ preventScroll: true }));
          }
        }
      }
      uploads.notify(t('copied'));
    } catch (e) {
      uploads.notify(errorText(e), 'danger');
    } finally {
      setBusy(false);
      setSharingOperation(null);
    }
  }
  async function revoke(file: LibraryFile) {
    setBusy(true);
    setSharingOperation('revoke');
    try {
      const r = await shelfApi<{ file: LibraryFile }>(`/api/v1/medias/${file.id}/share`, {
        method: 'DELETE',
      });
      replace(r.file);
      uploads.notify(t('sharingStopped'));
      // Removing a result shifts server page boundaries. Reload from page one
      // so loading more cannot skip a file after revocation.
      if (sharedOnly) {
        uploads.refresh();
        sharingFilter.current?.focus();
      }
    } catch (e) {
      uploads.notify(errorText(e), 'danger');
    } finally {
      setBusy(false);
      setSharingOperation(null);
    }
  }
  const targetFiles =
    action === 'delete'
      ? deletionTargets
      : viewed
        ? [viewed]
        : files.filter((f) => selected.includes(f.id));
  const targets =
    action === 'delete' ? deletionTargets.map((file) => file.id) : viewed ? [viewed.id] : selected;
  function openAction(next: Action) {
    if (next === 'delete') setDeletionTargets(targetFiles);
    setActionError('');
    setCollectionName('');
    setName(next === 'renameCollection' ? activeCollection?.name || '' : viewed?.name || '');
    setAction(next);
  }
  function closeAction() {
    if (busy) return;
    setAction(null);
    if (action === 'organize') {
      if (collectionId && viewed && !viewed.collections.includes(collectionId)) setViewed(null);
      uploads.refresh();
    }
  }
  async function perform(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError('');
    try {
      if (action === 'rename' && viewed) {
        const { file } = await shelfApi<{ file: LibraryFile }>(`/api/v1/medias/${viewed.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        replace(file);
        if (!matchesResult(file)) uploads.refresh();
      }
      if (action === 'delete') {
        const ids = [...targets];
        for (const id of ids) {
          await shelfApi(`/api/v1/medias/${id}`, { method: 'DELETE' });
          setFiles((prev) => prev.filter((f) => f.id !== id));
          setDeletionTargets((prev) => prev.filter((file) => file.id !== id));
          setSelected((prev) => prev.filter((selectedId) => selectedId !== id));
          setViewed((prev) => (prev?.id === id ? null : prev));
        }
        setViewed(null);
        setSelected([]);
        uploads.refresh();
        uploads.notify(t('removed', { count: ids.length }));
      }
      if (action === 'renameCollection' && collectionId) {
        await shelfApi(`/api/v1/collections/${collectionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        uploads.refresh();
      }
      if (action === 'deleteCollection' && collectionId) {
        await shelfApi(`/api/v1/collections/${collectionId}`, { method: 'DELETE' });
        router.push('/collections');
        return;
      }
      setAction(null);
    } catch (e) {
      setActionError(
        action === 'renameCollection' && e instanceof ShelfApiError && e.code === 'invalidName'
          ? t('invalidCollectionName', { max: COLLECTION_NAME_MAX_LENGTH })
          : errorText(e),
      );
      if (action === 'delete') uploads.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function membership(id: string, add: boolean) {
    setBusy(true);
    setMembershipPending(`${id}:${add}`);
    setActionError('');
    try {
      await shelfApi(`/api/v1/collections/${id}/members`, {
        method: add ? 'POST' : 'DELETE',
        body: JSON.stringify({ ids: targets }),
      });
      const change = (f: LibraryFile) =>
        targets.includes(f.id)
          ? {
              ...f,
              collections: add
                ? [...new Set([...f.collections, id])]
                : f.collections.filter((c) => c !== id),
            }
          : f;
      setFiles((prev) => prev.map(change));
      setViewed((prev) => (prev ? change(prev) : prev));
      uploads.notify(t('collectionUpdated'));
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
      setMembershipPending(null);
    }
  }
  async function createMembershipCollection(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !collectionName.trim() || collectionName.length > COLLECTION_NAME_MAX_LENGTH)
      return;
    setBusy(true);
    setActionError('');
    try {
      const { collection } = await shelfApi<{ collection: LibraryCollection }>(
        '/api/v1/collections',
        { method: 'POST', body: JSON.stringify({ name: collectionName }) },
      );
      setCollections((current) => [...current, collection]);
      setCollectionName('');
      await membership(collection.id, true);
    } catch (e) {
      setActionError(
        e instanceof ShelfApiError && e.code === 'invalidName'
          ? t('invalidCollectionName', { max: COLLECTION_NAME_MAX_LENGTH })
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  }
  const closeViewer = useCallback(() => {
    setViewed(null);
  }, []);
  useEffect(() => {
    if (!viewed || action) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest('.mobile-sheet')) return;
      if ((e.target as HTMLElement).closest('input,textarea,select,video,audio')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const i = files.findIndex((f) => f.id === viewed.id);
        setViewed(
          files[(i + (e.key === 'ArrowRight' ? 1 : -1) + files.length) % files.length] || viewed,
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewed, action, files]);
  const title = collectionId
    ? activeCollection?.name || t('collections')
    : favorites
      ? t('favorites')
      : t('library');
  const filtered = Boolean(query.trim() || search.trim() || type !== 'all');
  const emptyVariant = filtered
    ? 'search'
    : sharedOnly
      ? 'shared'
      : favorites
        ? 'favorites'
        : collectionId
          ? 'collection'
          : 'library';
  const empty = !loading && !error && !files.length;
  return (
    <>
      <section className="intro">
        {collectionId && (
          <Link className="text-button" href="/collections">
            <ArrowLeft size={14} />
            {t('collections')}
          </Link>
        )}
        <h1
          className={collectionId ? 'collection-title' : undefined}
          title={collectionId ? title : undefined}
        >
          {title}
        </h1>
        {(collectionId || favorites) && (
          <p>{t(collectionId ? 'collectionIntro' : 'favoritesIntro')}</p>
        )}
      </section>
      <section className="library">
        <div className="library-heading">
          <label className="search library-search">
            <Search size={16} />
            <input
              aria-label={t('searchLabel')}
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label={t('clearSearch')} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
          <div className="sort">
            {!loading && !error && total > 0 && <span>{t('count', { count: total })}</span>}
            <LibrarySort value={order} onChange={setOrder} />
          </div>
        </div>
        <div className="library-heading">
          <div className="filters">
            <div
              className="file-type-filters"
              ref={typeFilters}
              role="group"
              aria-label={t('fileTypeFilter')}
            >
              {(['all', 'image', 'video', 'audio', 'document', 'other'] as const).map((kind) => (
                <button
                  key={kind}
                  className={type === kind ? 'chosen' : ''}
                  onClick={() => setType(kind)}
                  aria-pressed={type === kind}
                >
                  {t(`type_${kind}`)}
                </button>
              ))}
            </div>
            <button
              ref={sharingFilter}
              className={`sharing-filter${sharedOnly ? ' chosen' : ''}`}
              aria-pressed={sharedOnly}
              title={t('sharedFilterHint')}
              onClick={() => setSharedOnly((value) => !value)}
            >
              <Link2 size={15} aria-hidden="true" />
              {t('shared')}
            </button>
          </div>
          {collectionId && (
            <div className="collection-tools">
              <button
                className="icon-button"
                aria-label={t('renameCollection')}
                onClick={() => openAction('renameCollection')}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={t('deleteCollection')}
                onClick={() => openAction('deleteCollection')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
        <LibraryUploadCard collectionId={collectionId} />
        <MotionPresence present={selected.length > 0} className="selection-presence">
          <div className="selection-bar">
            <strong>{t('selectedCount', { count: selected.length })}</strong>
            <button className="text-button" onClick={() => setSelected(files.map((f) => f.id))}>
              {t('selectLoaded')}
            </button>
            <button
              className="button"
              onClick={() => {
                setViewed(null);
                openAction('organize');
              }}
            >
              <Layers size={15} />
              {t('organize')}
            </button>
            <button
              className="button"
              onClick={() => {
                setViewed(null);
                openAction('delete');
              }}
            >
              <Trash2 size={15} />
              {t('deleteFiles', { count: selected.length })}
            </button>
            <button
              className="icon-button"
              aria-label={t('clearSelection')}
              onClick={() => setSelected([])}
            >
              <X size={16} />
            </button>
          </div>
        </MotionPresence>
        {error && (
          <p className="shelf-error" role="alert">
            {error}{' '}
            <button className="text-button" onClick={uploads.refresh}>
              {t('retry')}
            </button>
          </p>
        )}
        <MotionGrid
          className="gallery library-gallery"
          aria-busy={loading}
          layoutKey={`${files.map((file) => file.id).join(',')}:${favorites}:${sharedOnly}:${search}:${type}`}
        >
          {files.map((file, index) => (
            <article
              key={file.id}
              data-motion-key={file.id}
              data-shared={file.shared}
              className={`picture ${file.kind === 'image' || file.kind === 'video' ? '' : 'nonvisual-card'} ${selected.includes(file.id) ? 'selected-card' : ''}`}
            >
              <button
                className="picture-open"
                aria-label={t('view', { name: file.name })}
                aria-describedby={`file-status-${file.id}`}
                onClick={() => {
                  setViewed(file);
                }}
              >
                <FileThumbnail file={file} priority={index < 12} />
                <span className="image-shade" />
                <span className="picture-caption" aria-hidden="true">
                  {file.kind !== 'image' && (
                    <span className="file-kind-indicator" title={t(`type_${file.kind}`)}>
                      <FileIcon kind={file.kind} size={14} />
                    </span>
                  )}
                  <span className="picture-caption-name" title={file.name}>
                    {file.name}
                  </span>
                  <span
                    className="picture-caption-status"
                    title={file.shared ? t('sharedFile') : undefined}
                  >
                    <span className="file-sharing-indicator" data-shared={file.shared}>
                      <Link2 size={14} />
                    </span>
                    <ArrowUpRight className="picture-open-arrow" size={16} />
                  </span>
                </span>
              </button>
              <label className="select-file">
                <input
                  type="checkbox"
                  aria-label={t('selectFile', { name: file.name })}
                  checked={selected.includes(file.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, file.id] : prev.filter((id) => id !== file.id),
                    )
                  }
                />
                <Check size={12} />
              </label>
              <button
                className={`favorite ${file.favorite ? 'is-favorite' : ''}`}
                aria-label={t(file.favorite ? 'unfavorite' : 'favorite')}
                aria-pressed={file.favorite}
                onClick={() => void favorite(file)}
              >
                <LiquidHeart filled={file.favorite} size={16} />
              </button>
              <span className="sr-only" id={`file-status-${file.id}`}>
                {t(`type_${file.kind}`)}
                {file.shared && <> · {t('sharedFile')}</>}
              </span>
            </article>
          ))}
          {empty && (
            <LibraryEmptyState
              variant={emptyVariant}
              title={t(`emptyState.${emptyVariant}Title`)}
              description={t(`emptyState.${emptyVariant}Hint`, { action: t('organize') })}
            >
              {filtered || sharedOnly ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setSearch('');
                    setType('all');
                    setSharedOnly(false);
                  }}
                >
                  {t(filtered ? 'emptyState.reset' : 'emptyState.showAll')}
                  <ArrowRight size={16} />
                </button>
              ) : favorites ? (
                <Link href="/" className="text-button">
                  {t('backLibrary')}
                  <ArrowRight size={16} />
                </Link>
              ) : null}
            </LibraryEmptyState>
          )}
        </MotionGrid>
        {loading && <LoadingState variant={files.length ? 'inline' : 'page'} />}
        {more && !loading && (
          <div className="load-more">
            <button className="button" disabled={loading} onClick={() => void loadMore()}>
              {t('loadMore')}
            </button>
          </div>
        )}
      </section>
      {viewed && mobile && (
        <MobileLibraryViewer
          inactive={!!action}
          file={viewed}
          previousFile={
            files[
              (files.findIndex((file) => file.id === viewed.id) - 1 + files.length) % files.length
            ]
          }
          nextFile={files[(files.findIndex((file) => file.id === viewed.id) + 1) % files.length]}
          position={files.findIndex((file) => file.id === viewed.id) + 1}
          total={files.length}
          busy={busy}
          sharingOperation={sharingOperation}
          onClose={closeViewer}
          onNavigate={(direction) =>
            setViewed(
              files[
                (files.findIndex((file) => file.id === viewed.id) + direction + files.length) %
                  files.length
              ],
            )
          }
          onFavorite={() => void favorite(viewed)}
          onCopy={() => void copy(viewed)}
          onRevoke={() => void revoke(viewed)}
          onAction={openAction}
        />
      )}
      {viewed && !action && !mobile && (
        <Dialog
          title={viewed.name}
          headerTitle={t('viewerPosition', {
            current: files.findIndex((file) => file.id === viewed.id) + 1,
            total: files.length,
          })}
          onClose={closeViewer}
          wide
        >
          <ViewerMedia file={viewed}>
            {files.length > 1 && (
              <>
                <button
                  className="viewer-prev"
                  aria-label={t('previous')}
                  onClick={() =>
                    setViewed(
                      files[
                        (files.findIndex((f) => f.id === viewed.id) - 1 + files.length) %
                          files.length
                      ],
                    )
                  }
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  className="viewer-next"
                  aria-label={t('next')}
                  onClick={() =>
                    setViewed(
                      files[(files.findIndex((f) => f.id === viewed.id) + 1) % files.length],
                    )
                  }
                >
                  <ArrowRight size={18} />
                </button>
              </>
            )}
          </ViewerMedia>
          <div className="viewer-info">
            <div>
              <h2>{viewed.name}</h2>
              <small>
                {t('fileDetails', {
                  size: formatFileSize(viewed.size, locale),
                  type: viewed.mime,
                })}
              </small>
            </div>
            <div className="viewer-actions">
              <button
                className="icon-button"
                aria-label={t(viewed.favorite ? 'unfavorite' : 'favorite')}
                aria-pressed={viewed.favorite}
                onClick={() => void favorite(viewed)}
              >
                <LiquidHeart key={viewed.id} filled={viewed.favorite} size={18} />
              </button>
              <a className="icon-button" aria-label={t('download')} href={viewed.links.download}>
                <ArrowDownToLine size={18} />
              </a>
              <button
                className="button primary-button"
                disabled={busy}
                aria-busy={sharingOperation === 'copy' || undefined}
                onClick={() => void copy(viewed)}
              >
                {sharingOperation === 'copy' ? <LoadingMark size={18} /> : <Copy size={15} />}
                {t('share')}
              </button>
            </div>
          </div>
          <div className="file-secondary-actions">
            <button className="text-button" onClick={() => openAction('rename')}>
              <Pencil size={14} />
              {t('rename')}
            </button>
            <button className="text-button" onClick={() => openAction('organize')}>
              <Layers size={14} />
              {t('organize')}
            </button>
            {viewed.shared && (
              <>
                <a
                  className="text-button"
                  target="_blank"
                  rel="noreferrer"
                  href={viewed.links.share}
                >
                  {t('preview')}
                  <ArrowUpRight size={14} />
                </a>
                <button
                  className="text-button sharing-revoke"
                  disabled={busy}
                  aria-busy={sharingOperation === 'revoke' || undefined}
                  onClick={() => void revoke(viewed)}
                >
                  {sharingOperation === 'revoke' ? (
                    <LoadingMark size={18} />
                  ) : (
                    <Link2Off size={14} />
                  )}
                  {t('stopSharing')}
                </button>
              </>
            )}
            <button className="text-button" onClick={() => openAction('delete')}>
              <Trash2 size={14} />
              {t('remove')}
            </button>
          </div>
        </Dialog>
      )}
      {action && (
        <Dialog
          mobilePresentation="sheet"
          canClose={!busy}
          title={t(
            action === 'delete'
              ? 'confirmDelete'
              : action === 'organize'
                ? 'organize'
                : action === 'renameCollection'
                  ? 'renameCollection'
                  : action === 'deleteCollection'
                    ? 'deleteCollection'
                    : 'rename',
            { count: targets.length },
          )}
          onClose={closeAction}
        >
          {action === 'organize' ? (
            <div className="shelf-form">
              <div className="membership-files">
                <h3>{t('membershipFiles', { count: targetFiles.length })}</h3>
                <ul tabIndex={0} aria-label={t('membershipFiles', { count: targetFiles.length })}>
                  {targetFiles.map((file) => (
                    <li key={file.id}>
                      <span className="membership-file-thumbnail" aria-hidden="true">
                        <FileThumbnail file={file} />
                      </span>
                      <span className="membership-file-name">{file.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p>{t('membershipHint')}</p>
              {!collections.length && (
                <form className="membership-create" onSubmit={createMembershipCollection}>
                  <p>{t('createCollectionFirst')}</p>
                  <label>
                    {t('collectionName')}
                    <input
                      autoComplete="off"
                      required
                      disabled={busy}
                      maxLength={COLLECTION_NAME_MAX_LENGTH}
                      aria-describedby="membership-collection-name-length"
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                    />
                    <small
                      id="membership-collection-name-length"
                      className="collection-name-length"
                    >
                      {t('collectionNameLength', {
                        count: collectionName.length,
                        max: COLLECTION_NAME_MAX_LENGTH,
                      })}
                    </small>
                  </label>
                  <div className="dialog-actions">
                    <Button isDisabled={busy} onPress={closeAction}>
                      {tc('cancel')}
                    </Button>
                    <button
                      className="button primary-button"
                      disabled={
                        busy ||
                        !collectionName.trim() ||
                        collectionName.length > COLLECTION_NAME_MAX_LENGTH
                      }
                      aria-busy={busy || undefined}
                    >
                      {busy && <LoadingMark size={18} />}
                      {t('createAndAdd')}
                    </button>
                  </div>
                </form>
              )}
              {collections.map((c) => {
                const allIn =
                  targetFiles.length > 0 && targetFiles.every((f) => f.collections.includes(c.id));
                const anyIn = targetFiles.some((f) => f.collections.includes(c.id));
                return (
                  <div key={c.id} className="membership-row">
                    <span title={c.name}>{c.name}</span>
                    {!allIn && (
                      <button
                        className="button"
                        disabled={busy}
                        aria-busy={membershipPending === `${c.id}:true` || undefined}
                        onClick={() => void membership(c.id, true)}
                      >
                        {membershipPending === `${c.id}:true` ? (
                          <LoadingMark size={18} />
                        ) : (
                          <Plus size={13} />
                        )}
                        {t('add')}
                      </button>
                    )}
                    {anyIn && (
                      <button
                        className={allIn ? 'button' : 'icon-button'}
                        disabled={busy}
                        aria-label={t('removeFromCollection')}
                        title={t('removeFromCollection')}
                        aria-busy={membershipPending === `${c.id}:false` || undefined}
                        onClick={() => void membership(c.id, false)}
                      >
                        {membershipPending === `${c.id}:false` ? (
                          <LoadingMark size={18} />
                        ) : (
                          <X size={18} />
                        )}
                        {allIn && t('membershipRemove')}
                      </button>
                    )}
                  </div>
                );
              })}
              {actionError && <FormError message={actionError} />}
            </div>
          ) : (
            <form className="shelf-form" onSubmit={perform}>
              {actionError && <FormError message={actionError} />}
              {action === 'delete' ? (
                <p>
                  {t('deleteWarning', {
                    count: targets.length,
                    name: targetFiles[0]?.name || t('viewerFile'),
                  })}
                </p>
              ) : action === 'deleteCollection' ? (
                <p>
                  {t('deleteCollectionHint', { name: activeCollection?.name || t('collections') })}
                </p>
              ) : (
                <label>
                  {t(action === 'renameCollection' ? 'collectionName' : 'fileName')}
                  <input
                    required
                    maxLength={action === 'renameCollection' ? COLLECTION_NAME_MAX_LENGTH : 255}
                    aria-describedby={
                      action === 'renameCollection' ? 'collection-name-length' : undefined
                    }
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {action === 'renameCollection' && (
                    <small id="collection-name-length" className="collection-name-length">
                      {t('collectionNameLength', {
                        count: name.length,
                        max: COLLECTION_NAME_MAX_LENGTH,
                      })}
                    </small>
                  )}
                </label>
              )}
              <div className="dialog-actions">
                <Button isDisabled={busy} onPress={closeAction}>
                  {tc('cancel')}
                </Button>
                <button
                  disabled={
                    busy ||
                    (action === 'renameCollection' &&
                      (!name.trim() || name.length > COLLECTION_NAME_MAX_LENGTH))
                  }
                  aria-busy={busy || undefined}
                  className="button primary-button"
                >
                  {busy && <LoadingMark size={18} />}
                  {action === 'delete'
                    ? t('deleteFiles', { count: targets.length })
                    : t(action === 'deleteCollection' ? 'deleteCollection' : 'save')}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
