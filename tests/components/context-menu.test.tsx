// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ContextMenu from '@/components/ui/ContextMenu';

describe('ContextMenu', () => {
  it('closes on an outside pointer down even when the target stops propagation', async () => {
    const onClose = vi.fn();

    render(
      <>
        <button onPointerDown={(event) => event.stopPropagation()}>outside</button>
        <ContextMenu
          isOpen
          position={{ x: 20, y: 20 }}
          onClose={onClose}
          sections={[{ items: [{ label: 'Open', onClick: vi.fn() }] }]}
        />
      </>,
    );

    await screen.findByRole('menu');
    fireEvent.pointerDown(screen.getByText('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the menu open when pointer down starts inside the menu', async () => {
    const onClose = vi.fn();

    render(
      <>
        <button>outside</button>
        <ContextMenu
          isOpen
          position={{ x: 20, y: 20 }}
          onClose={onClose}
          sections={[{ items: [{ label: 'Open', onClick: vi.fn() }] }]}
        />
      </>,
    );

    fireEvent.pointerDown(await screen.findByText('Open'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('runs the focused menu item from keyboard after moving focus', async () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();

    render(
      <ContextMenu
        isOpen
        position={{ x: 20, y: 20 }}
        onClose={onClose}
        sections={[{ items: [{ label: 'Open', onClick: onOpen }] }]}
      />,
    );

    await screen.findByRole('menu');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });
});
