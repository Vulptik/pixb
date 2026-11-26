// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import ContextMenu from '@/components/ui/ContextMenu';
const setOpen = vi.hoisted(() => vi.fn());
vi.mock('@/lib/contexts/ContextMenuContext', () => ({
  useContextMenu: () => ({ isContextMenuOpen: false, setIsContextMenuOpen: setOpen }),
}));
afterEach(cleanup);
it('skips disabled items in both keyboard directions and handles escape and scrolling', async () => {
  const close = vi.fn(),
    first = vi.fn(),
    last = vi.fn();
  render(
    <ContextMenu
      isOpen
      position={{ x: 20, y: 20 }}
      onClose={close}
      sections={[
        {
          items: [
            { label: 'First', onClick: first },
            { label: 'Disabled', disabled: true, onClick: vi.fn() },
          ],
        },
        { items: [{ label: 'Last', onClick: last, variant: 'warning' }] },
      ]}
    />,
  );
  await screen.findByRole('menu');
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveClass('bg-content2');
  expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'ArrowUp' });
  fireEvent.keyDown(document, { key: 'ArrowUp' });
  expect(screen.getByRole('menuitem', { name: 'First' })).toHaveClass('bg-content2');
  expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Enter' });
  await waitFor(() => expect(first).toHaveBeenCalledOnce());
  expect(last).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.scroll(document);
  expect(close).toHaveBeenCalledTimes(3);
});

it('activates the item reached with Tab and restores the opener on Escape', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  function Menu() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open menu</button>
        <ContextMenu
          isOpen={open}
          position={{ x: 20, y: 20 }}
          onClose={() => setOpen(false)}
          sections={[{ items: [{ label: 'Copy', onClick: action }] }]}
        />
      </>
    );
  }
  render(<Menu />);
  const opener = screen.getByRole('button', { name: 'Open menu' });
  await user.click(opener);
  await user.tab();
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  await user.click(opener);
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(opener).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('does not intercept keys after focus moves outside the menu', async () => {
  const action = vi.fn();
  const close = vi.fn();
  render(
    <>
      <input aria-label="Unrelated" />
      <ContextMenu
        isOpen
        position={{ x: 20, y: 20 }}
        onClose={close}
        sections={[{ items: [{ label: 'Copy', onClick: action }] }]}
      />
    </>,
  );
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
  const input = screen.getByRole('textbox', { name: 'Unrelated' });
  input.focus();
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveFocus();
  expect(action).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
it('contains pointer and mouse events and closes only on outside wheel events', async () => {
  const close = vi.fn(),
    parent = vi.fn();
  render(
    <div
      onMouseDown={parent}
      onMouseUp={parent}
      onClick={parent}
      onPointerDown={parent}
      onPointerUp={parent}
    >
      <ContextMenu
        isOpen
        position={{ x: 20, y: 20 }}
        onClose={close}
        sections={[
          {
            items: [
              { label: 'Delete', variant: 'danger', onClick: vi.fn() },
              { label: 'Open', variant: 'primary', onClick: vi.fn() },
            ],
          },
        ]}
      />
    </div>,
  );
  const menu = await screen.findByRole('menu'),
    button = screen.getByText('Delete');
  for (const target of [menu, button]) {
    fireEvent.mouseDown(target);
    fireEvent.mouseUp(target);
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
  }
  fireEvent.click(menu);
  fireEvent.wheel(menu);
  expect(parent).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.wheel(document);
  expect(close).toHaveBeenCalledOnce();
});
