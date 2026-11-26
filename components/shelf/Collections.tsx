'use client';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { CollectionCover } from './CollectionCover';
import { FormError } from '@/components/ui/FormError';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { shelfApi, ShelfApiError } from './api';
import { Dialog } from './Dialog';
import { Button } from '@/components/ui/primitives';
import { LibraryEmptyState } from './LibraryEmptyState';
import { LibraryUploadCard } from './LibraryUploadCard';
import { MotionGrid } from '@/components/ui/MotionGrid';
import { useShelfUploads } from './ShelfUploads';
import type { LibraryCollection } from '@/types/library';
import { COLLECTION_NAME_MAX_LENGTH } from '@/lib/config/library';
import { useServerHydration } from '@/lib/hooks/useServerHydration';
export function Collections({
  initialCollections,
}: { initialCollections?: LibraryCollection[] } = {}) {
  const tc = useTranslations('common');
  const t = useTranslations('shelf'),
    { revision, refresh, notify } = useShelfUploads();
  const serverHydration = useServerHydration();
  const initialRequest = useRef(initialCollections !== undefined && serverHydration);
  const initialRevalidation = useRef(initialCollections !== undefined && !serverHydration);
  const [items, setItems] = useState<LibraryCollection[]>(initialCollections ?? []),
    [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(initialCollections === undefined);
  useEffect(() => {
    if (initialRequest.current && revision === 0) return;
    initialRequest.current = false;
    let live = true;
    if (!initialRevalidation.current) setLoading(true);
    shelfApi<{ collections: LibraryCollection[] }>('/api/v1/collections')
      .then((r) => {
        if (live) {
          setItems(r.collections);
          setError('');
        }
      })
      .catch(() => {
        if (live) setError(t('requestFailed'));
      })
      .finally(() => {
        if (live) {
          initialRevalidation.current = false;
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [revision, t]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await shelfApi('/api/v1/collections', { method: 'POST', body: JSON.stringify({ name }) });
      setOpen(false);
      setName('');
      refresh();
      notify(t('collectionCreated'));
    } catch (e) {
      setError(
        t(
          e instanceof ShelfApiError && e.code === 'invalidName'
            ? 'invalidCollectionName'
            : 'requestFailed',
          { max: COLLECTION_NAME_MAX_LENGTH },
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="intro">
        <h1>{t('collections')}</h1>
        <p>{t('collectionsIntro')}</p>
      </section>
      <div className="library-heading">
        <span>
          {!loading && !error && items.length > 0 && t('collectionCount', { count: items.length })}
        </span>
        <button className="button primary-button" onClick={() => setOpen(true)}>
          <Plus size={16} />
          {t('newCollection')}
        </button>
      </div>
      <LibraryUploadCard />
      {error && !open && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={refresh}>
            {t('retry')}
          </button>
        </p>
      )}
      {loading ? (
        <LoadingState variant="page" />
      ) : (
        <MotionGrid
          className="gallery collection-gallery"
          layoutKey={items.map((item) => item.id).join(',')}
        >
          {items.map((c, index) => (
            <Link
              className="collection-card"
              href={`/collections/${c.id}`}
              key={c.id}
              data-motion-key={c.id}
            >
              <CollectionCover previews={c.previews} priority={index < 6} />
              <div className="collection-info">
                <h2 title={c.name}>{c.name}</h2>
                <p>{t('collectionFileCount', { count: c.count })}</p>
              </div>
            </Link>
          ))}
        </MotionGrid>
      )}
      {!loading && !error && !items.length && (
        <LibraryEmptyState
          variant="collection"
          title={t('noCollections')}
          description={t('emptyCollectionsHint')}
        >
          <button className="text-button" onClick={() => setOpen(true)}>
            <Plus size={16} />
            {t('newCollection')}
          </button>
        </LibraryEmptyState>
      )}
      {open && (
        <Dialog
          mobilePresentation="sheet"
          canClose={!busy}
          title={t('newCollection')}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="shelf-form" onSubmit={create}>
            {error && <FormError message={error} />}
            <label>
              {t('collectionName')}
              <input
                autoComplete="off"
                required
                maxLength={COLLECTION_NAME_MAX_LENGTH}
                aria-describedby="collection-name-length"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <small id="collection-name-length" className="collection-name-length">
                {t('collectionNameLength', { count: name.length, max: COLLECTION_NAME_MAX_LENGTH })}
              </small>
            </label>
            <div className="dialog-actions">
              <Button isDisabled={busy} onPress={() => setOpen(false)}>
                {tc('cancel')}
              </Button>
              <button
                disabled={busy || !name.trim() || name.length > COLLECTION_NAME_MAX_LENGTH}
                aria-busy={busy || undefined}
                className="button primary-button"
              >
                {busy && <LoadingMark size={18} />}
                {t('create')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
