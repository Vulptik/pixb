export type FileKind = 'image' | 'video' | 'audio' | 'document' | 'other';
export type LibraryFile = {
  id: string;
  name: string;
  mime: string;
  size: string;
  createdAt: string;
  kind: FileKind;
  favorite: boolean;
  shared: boolean;
  collections: string[];
  links: {
    original: string;
    download: string;
    thumbnail: string | null;
    poster: string | null;
    preview: string | null;
    share: string;
  };
};
export type CollectionPreview = { id: string; kind: FileKind; thumbnail: string | null };
export type LibraryCollection = {
  id: string;
  name: string;
  count: number;
  cover: string | null;
  previews: CollectionPreview[];
};
export type LibraryPage = { files: LibraryFile[]; page: number; hasMore: boolean; total: number };
export type InitialLibraryData = { page: LibraryPage; collections: LibraryCollection[] };
