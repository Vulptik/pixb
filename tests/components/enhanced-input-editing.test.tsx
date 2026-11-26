// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EnhancedInput from '@/components/ui/EnhancedInput';
import type { ContextMenuProps } from '@/types';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/ui/ContextMenu', () => ({
  default: ({ isOpen, sections, onClose }: ContextMenuProps) =>
    isOpen ? (
      <div role="menu">
        {sections
          .flatMap((s) => s.items)
          .map((item) => (
            <button key={item.label} onClick={item.onClick}>
              {item.label}
            </button>
          ))}
        <button onClick={onClose}>close menu</button>
      </div>
    ) : null,
}));
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('XY'),
    },
  });
});
afterEach(cleanup);
function open(input: HTMLInputElement) {
  fireEvent.contextMenu(input, { clientX: 10, clientY: 15 });
}
async function action(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name, exact: true }));
  });
}

describe('enhanced input text editing', () => {
  it('selects all, copies, cuts and pastes over a selection and reports the new value', async () => {
    const changes: string[] = [];
    render(
      <EnhancedInput
        aria-label="Text"
        defaultValue="abcdef"
        onChange={(e) => {
          e.preventDefault();
          e.stopPropagation();
          changes.push(e.target.value);
        }}
      />,
    );
    const input = screen.getByLabelText('Text') as HTMLInputElement;
    open(input);
    await action('selectAll');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(6);
    await action('copy');
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('abcdef');
    input.setSelectionRange(1, 3);
    await action('cut');
    expect(input.value).toBe('adef');
    expect(changes.at(-1)).toBe('adef');
    expect(input.selectionStart).toBe(1);
    input.setSelectionRange(1, 3);
    await action('paste');
    expect(input.value).toBe('aXYf');
    expect(changes.at(-1)).toBe('aXYf');
    expect(input.selectionStart).toBe(3);
    await action('close menu');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('ignores empty selections and clipboard content and leaves values intact on clipboard failures', async () => {
    render(<EnhancedInput aria-label="Text" defaultValue="abcdef" />);
    const input = screen.getByLabelText('Text') as HTMLInputElement;
    open(input);
    input.setSelectionRange(0, 0);
    await action('copy');
    await action('cut');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('');
    await action('paste');
    expect(input.value).toBe('abcdef');
    input.setSelectionRange(1, 3);
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    await action('copy');
    await action('cut');
    expect(input.value).toBe('abcdef');
    vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(new Error('denied'));
    await action('paste');
    expect(input.value).toBe('abcdef');
  });
  it('does not offer destructive edits for read-only inputs or custom menus when disabled', async () => {
    const { rerender } = render(
      <EnhancedInput aria-label="Text" defaultValue="hello" isReadOnly />,
    );
    const input = screen.getByLabelText('Text') as HTMLInputElement;
    open(input);
    expect(screen.queryByText('cut')).not.toBeInTheDocument();
    expect(screen.queryByText('paste')).not.toBeInTheDocument();
    rerender(<EnhancedInput aria-label="Text" showContextMenu={false} />);
    open(input);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('generates strong passwords, propagates edits, clears, and toggles reveal in both directions', async () => {
    const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }),
      onClear = vi.fn(),
      reveal = vi.fn();
    render(
      <EnhancedInput
        aria-label="Password"
        type="password"
        showPasswordStrength
        showGenerateButton
        showRevealToggle
        isClearable
        onChange={onChange}
        onClear={onClear}
        onRevealToggle={reveal}
        size="full"
        variant="outline"
      />,
    );
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.click(screen.getByLabelText('generate'));
    expect(input.value.length).toBeGreaterThanOrEqual(8);
    expect(onChange).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'New123!' } });
    fireEvent.click(screen.getByLabelText('clear'));
    expect(input.value).toBe('');
    expect(onClear).toHaveBeenCalledOnce();
    open(input);
    await action('reveal');
    expect(input.type).toBe('text');
    await action('hide');
    expect(input.type).toBe('password');
    expect(reveal.mock.calls).toEqual([[true], [false]]);
  });
  it.each(['default', 'filled'] as const)(
    'supports %s visual variant while editing without callbacks',
    async (variant) => {
      render(<EnhancedInput aria-label="Text" defaultValue="abc" variant={variant} size="xl" />);
      const input = screen.getByLabelText('Text') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'abcde' } });
      open(input);
      input.setSelectionRange(0, 1);
      await action('cut');
      await action('paste');
      expect(input.value).toBe('XYbcde');
    },
  );
});
