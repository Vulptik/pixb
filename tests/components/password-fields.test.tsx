// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { PasswordField, PasswordFields } from '@/components/ui/PasswordField';
import { PASSWORD_REGEX } from '@/lib/utils/validationPatterns';
import english from '@/messages/en.json';
import french from '@/messages/fr.json';

afterEach(cleanup);

describe('shared password fields', () => {
  for (const [locale, messages] of [
    ['en', english],
    ['fr', french],
  ] as const) {
    it(`generates matching, valid form values with live guidance in ${locale}`, () => {
      const { container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <form>
            <PasswordFields
              idPrefix="test"
              passwordLabel={messages.shelf.password}
              confirmationLabel={messages.shelf.confirmPassword}
            />
          </form>
        </NextIntlClientProvider>,
      );
      const password = screen.getByLabelText(messages.shelf.password) as HTMLInputElement;
      const confirmation = screen.getByLabelText(messages.shelf.confirmPassword);
      const meter = screen.getByRole('meter', { name: messages.common.passwordStrength });
      expect(meter).toHaveAttribute('aria-valuenow', '0');
      fireEvent.click(screen.getByRole('button', { name: messages.common.generate }));
      expect(password.value).toMatch(PASSWORD_REGEX);
      expect(confirmation).toHaveValue(password.value);
      expect(meter).toHaveAttribute('aria-valuenow', '5');
      expect(new FormData(container.querySelector('form')!).get('password_confirmation')).toBe(
        password.value,
      );
      fireEvent.click(screen.getByRole('button', { name: messages.common.showPassword }));
      expect(password).toHaveAttribute('type', 'text');
      expect(confirmation).toHaveAttribute('type', 'password');
      fireEvent.click(screen.getByRole('button', { name: messages.common.hidePassword }));
      expect(password).toHaveAttribute('type', 'password');
      fireEvent.change(password, { target: { value: '' } });
      expect(meter).toHaveAttribute('aria-valuenow', '0');
      expect(confirmation).not.toHaveValue('');
    });
  }

  it('disables generation and both reveal controls during submission', () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PasswordFields idPrefix="test" passwordLabel="New" confirmationLabel="Confirm" disabled />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText('New')).toBeDisabled();
    expect(screen.getByLabelText('Confirm')).toBeDisabled();
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('keeps existing-password entry free of generation and strength requirements', () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PasswordField label="Password" autoComplete="current-password" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByRole('button', { name: english.common.generate })).toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'existing' } });
    fireEvent.click(screen.getByRole('button', { name: english.common.showPassword }));
    expect(screen.getByLabelText('Password')).toHaveValue('existing');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });
});
