// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

const state = vi.hoisted(() => ({ choose: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/components/shelf/ShelfUploads', () => ({ useShelfUploads: () => state }));
vi.mock('@/lib/contexts/UserContext', async () => {
  const { createContext } = await import('react');
  return { default: createContext({ data: { attributes: { username: 'Alex' } } }) };
});
import { Welcome } from '@/components/shelf/Welcome';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function tree(locale = 'en') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <Welcome />
    </NextIntlClientProvider>
  );
}

it('greets the signed-in person and waits for their choice', () => {
  render(tree());
  expect(screen.getByRole('heading', { name: 'Welcome to PixB, Alex.' })).toHaveFocus();
  expect(screen.getByText(en.shelf.welcomeHint)).toBeInTheDocument();
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.choose).not.toHaveBeenCalled();
});

it('opens the picker synchronously before entering the library', () => {
  render(tree());
  state.choose.mockImplementationOnce(() => expect(state.replace).not.toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: en.shelf.welcomeUpload }));
  expect(state.choose).toHaveBeenCalledTimes(1);
  expect(state.replace).toHaveBeenCalledWith('/');
});

it('lets people explore without opening the picker', () => {
  render(tree());
  fireEvent.click(screen.getByRole('button', { name: en.shelf.welcomeExplore }));
  expect(state.replace).toHaveBeenCalledWith('/');
  expect(state.choose).not.toHaveBeenCalled();
});

it('welcomes French-speaking users with translated copy and actions', () => {
  render(tree('fr'));
  expect(screen.getByRole('heading', { name: 'Bienvenue sur PixB, Alex.' })).toHaveFocus();
  expect(screen.getByText(fr.shelf.welcomeHint)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: fr.shelf.welcomeUpload })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: fr.shelf.welcomeExplore })).toBeInTheDocument();
});
