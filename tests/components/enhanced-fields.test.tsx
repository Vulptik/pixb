// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EnhancedInput from '@/components/ui/EnhancedInput';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => {
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(' pasted'),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('retained enhanced input', () => {
  it('distinguishes password confirmation controls from the password control', async () => {
    render(
      <>
        <EnhancedInput id="primary" type="password" aria-label="Password" showRevealToggle />
        <EnhancedInput
          id="confirmation"
          type="password"
          aria-label="Confirm password"
          showRevealToggle
          confirmation
        />
      </>,
    );
    const toggle = screen.getByRole('button', { name: 'showPasswordConfirmation' });
    expect(toggle).toHaveAttribute('aria-controls', 'confirmation');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'hidePasswordConfirmation' })).toBe(toggle);
  });
  it('links shared input errors to their fields and exposes invalid/reveal state', async () => {
    render(
      <>
        <p id="password-hint">Hint</p>
        <EnhancedInput
          id="new-password"
          name="password"
          aria-label="New password"
          aria-describedby="password-hint"
          type="password"
          isInvalid
          errorMessage="Choose a longer password"
          showRevealToggle
        />
      </>,
    );
    const input = screen.getByLabelText('New password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'password-hint new-password-help');
    expect(screen.getByText('Choose a longer password')).toHaveAttribute('id', 'new-password-help');
    const toggle = screen.getByRole('button', { name: 'showPassword' });
    expect(toggle).toHaveAttribute('aria-controls', 'new-password');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
  it('supports context actions, reveal, clear, and password generation', async () => {
    const onChange = vi.fn(),
      onClear = vi.fn(),
      onGenerate = vi.fn();
    render(
      <EnhancedInput
        aria-label="Password"
        type="password"
        value="Secret123!"
        onChange={onChange}
        onClear={onClear}
        showRevealToggle
        showPasswordStrength
        showGenerateButton
        isClearable
        onGenerate={onGenerate}
      />,
    );
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    input.setSelectionRange(0, 6);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 20 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(screen.getByText('selectAll')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /copy/ }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Secret');
    await userEvent.click(screen.getByLabelText('showPassword'));
    expect(input.type).toBe('text');
    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[0]);
    expect(onGenerate).toHaveBeenCalled();
    await userEvent.click(buttons[1]);
    expect(onClear).toHaveBeenCalled();
  });
});
