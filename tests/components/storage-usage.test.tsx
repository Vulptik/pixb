// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import frenchMessages from '@/messages/fr.json';
import type { QuotaType } from '@/types';

const state = vi.hoisted(() => ({
  quota: null as QuotaType | null,
  pendingBytes: 0,
  pendingFileCount: 0,
  dragging: false,
  quotaError: false,
  quotaIssue: false,
  choose: vi.fn(),
  refreshQuota: vi.fn(),
  dismissQuotaIssue: vi.fn(),
}));
vi.mock('@/components/shelf/ShelfUploads', () => ({ useShelfUploads: () => state }));
import { StorageNotice, StorageUploadControl } from '@/components/shelf/StorageUsage';

const quota = (used: number, total: number | null = 1024): QuotaType => ({
  used,
  total,
  unlimited: total === null,
  count: 1,
  readable_used: '',
  readable_total: null,
});
function tree(props: React.ComponentProps<typeof StorageUploadControl> = {}, locale = 'en') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? frenchMessages : messages}>
      <StorageUploadControl {...props} />
      <StorageNotice />
    </NextIntlClientProvider>
  );
}
let reduced = false;
let changed: (() => void) | undefined;
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    quota: quota(256),
    pendingBytes: 0,
    pendingFileCount: 0,
    dragging: false,
    quotaError: false,
    quotaIssue: false,
  });
  reduced = false;
  changed = undefined;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_event: string, callback: () => void) => {
        changed = callback;
      },
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal('Animation', class {});
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps upload usable before quota loads and hides an empty header control', () => {
  state.quota = null;
  const view = render(tree({ collection: 'summer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
  expect(state.choose).toHaveBeenCalledWith('summer');
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  view.rerender(tree({ header: true }));
  expect(view.container).toBeEmptyDOMElement();
});

it('shows a compact upload summary alongside usage and quota refresh controls', () => {
  state.pendingBytes = 128;
  state.pendingFileCount = 3;
  state.quotaError = true;
  render(tree());
  const trigger = screen.getByRole('button', { name: /Your storage: / });
  expect(trigger).toHaveTextContent('25%');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(state.refreshQuota).toHaveBeenCalledOnce();
  expect(screen.getByText(/768 byte available/)).toBeInTheDocument();
  const queue = within(screen.getByRole('group', { name: 'Upload queue' }));
  expect(queue.getByText('128 byte')).toBeInTheDocument();
  expect(queue.getByText('3 files')).toBeInTheDocument();
  expect(screen.queryByText(/used after this upload/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.refreshQuota).toHaveBeenCalledTimes(2);
  expect(state.choose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('shows the remaining file count in French and clears it when the last file finishes', () => {
  state.pendingFileCount = 1;
  const view = render(tree({ header: true }, 'fr'));
  fireEvent.click(screen.getByRole('button', { name: /Votre stockage/ }));
  const queue = within(screen.getByRole('group', { name: 'File d’envoi' }));
  expect(queue.getByText('1 fichier')).toBeInTheDocument();
  state.pendingFileCount = 0;
  state.pendingBytes = 128;
  view.rerender(tree({ header: true }, 'fr'));
  expect(queue.queryByText('1 fichier')).not.toBeInTheDocument();
  expect(queue.getByText('128 o')).toBeInTheDocument();
});

it('closes on outside pointer, window blur, Escape and leaving the disclosure', () => {
  render(tree());
  const trigger = screen.getByRole('button', { name: /Your storage: / });
  const disclosure = trigger.parentElement!;
  fireEvent.mouseEnter(disclosure);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.mouseLeave(disclosure);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.focus(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(trigger, { relatedTarget: trigger });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(trigger, { relatedTarget: document.body });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.pointerDown(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(document.body);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent(window, new Event('blur'));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('returns keyboard focus from details on Escape and positions the popup on resize', () => {
  state.quotaError = true;
  render(tree({ header: true }));
  const trigger = screen.getByRole('button', { name: /Your storage: / });
  fireEvent.click(trigger);
  const details = screen.getByRole('region', { name: 'Your storage' });
  expect(details.style.getPropertyValue('--storage-right')).toBe('-16px');
  fireEvent(window, new Event('resize'));
  act(() => screen.getByRole('button', { name: 'Retry' }).focus());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('shows unlimited storage and queued bytes', () => {
  state.quota = quota(1024 ** 5, null);
  state.pendingBytes = 1024;
  state.dragging = true;
  render(tree());
  expect(screen.getByRole('button', { name: 'Add files' })).toHaveAttribute(
    'data-limited',
    'false',
  );
  const trigger = screen.getByRole('button', { name: /Your storage: / });
  expect(trigger).toHaveTextContent('∞');
  fireEvent.click(trigger);
  expect(screen.getByText('No per-user storage limit.')).toBeInTheDocument();
  const queue = within(screen.getByRole('group', { name: 'Upload queue' }));
  expect(queue.getByText('1 kB')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it.each([0, -1])('treats an invalid total of %s as unlimited', (total) => {
  state.quota = quota(0, total);
  render(tree());
  expect(screen.getByRole('button', { name: /Your storage:/ })).toHaveTextContent('∞');
});

it.each([950, 1024, 2048])(
  'warns at high usage (%s bytes) and clamps remaining storage',
  (used) => {
    state.quota = quota(used);
    render(tree());
    expect(screen.getByRole('status')).toHaveTextContent(
      used >= 1024 ? 'Storage full' : 'Almost full',
    );
    expect(
      screen.queryByRole('button', { name: 'Dismiss storage message' }),
    ).not.toBeInTheDocument();
  },
);

it('prioritizes and dismisses an oversized selection warning', () => {
  state.quotaIssue = true;
  render(tree());
  expect(screen.getByRole('status')).toHaveTextContent('These files won’t fit');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss storage message' }));
  expect(state.dismissQuotaIssue).toHaveBeenCalledOnce();
});

it('animates pointer, focus and quota updates, and cancels motion when reduced motion changes', () => {
  const view = render(tree());
  const upload = screen.getByRole('button', { name: 'Add files' });
  fireEvent(upload, new MouseEvent('pointerover', { bubbles: true }));
  expect(animate).not.toHaveBeenCalled();
  const pointer = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(pointer, 'pointerType', { value: 'mouse' });
  fireEvent(upload, pointer);
  expect(animate).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ iterations: Infinity }),
  );
  fireEvent.pointerLeave(upload);
  expect(animate).toHaveBeenLastCalledWith(
    expect.any(Array),
    expect.objectContaining({ duration: 600 }),
  );
  fireEvent.focus(upload);
  fireEvent.blur(upload);
  state.quota = quota(512);
  view.rerender(tree());
  expect(animate).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ duration: 900 }),
  );
  reduced = true;
  act(() => changed?.());
  expect(cancel).toHaveBeenCalled();
  animate.mockClear();
  state.pendingBytes = 100;
  view.rerender(tree());
  fireEvent.pointerLeave(upload);
  expect(animate).not.toHaveBeenCalled();
});
