// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CollectionCover } from '@/components/shelf/CollectionCover';

afterEach(cleanup);

it('shows one thumbnail without inventing duplicate photos and keeps the cover decorative', () => {
  const { container } = render(
    <CollectionCover previews={[{ id: '1', kind: 'image', thumbnail: '/thumb/1' }]} />,
  );
  expect(container.querySelectorAll('img')).toHaveLength(1);
  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelector('img')).toHaveAttribute('alt', '');
});

it('renders mixed media, caps the stack at three, and falls back when a thumbnail fails', () => {
  const { container } = render(
    <CollectionCover
      previews={[
        { id: '1', kind: 'image', thumbnail: '/thumb/1' },
        { id: '2', kind: 'audio', thumbnail: null },
        { id: '3', kind: 'document', thumbnail: null },
        { id: '4', kind: 'video', thumbnail: '/thumb/4' },
      ]}
    />,
  );
  expect(container.querySelectorAll('.collection-cover-photo')).toHaveLength(3);
  expect(container.querySelectorAll('img')).toHaveLength(1);
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelectorAll('img')).toHaveLength(0);
  expect(container.querySelectorAll('.collection-cover-photo > svg')).toHaveLength(3);
});

it('keeps empty collections as an empty cover instead of a fake stack', () => {
  const { container } = render(<CollectionCover previews={[]} />);
  expect(container.querySelector('.collection-cover-photo')).toBeNull();
  expect(container.querySelector('svg')).toBeInTheDocument();
});

it('tolerates a collection response cached before previews were added', () => {
  const { container } = render(<CollectionCover />);
  expect(container.querySelector('svg')).toBeInTheDocument();
});
