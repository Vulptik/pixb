import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Card from '@/components/ui/Card';
import { Button } from '@/components/ui/primitives';
describe('retained form primitives', () => {
  it('renders primitive controls without a browser DOM', () => {
    const html = renderToStaticMarkup(
      <Button color="primary" startContent={<span>+</span>}>
        Save
      </Button>,
    );
    expect(html).toContain('Save');
  });
  it('retains reusable form cards', () => {
    expect(renderToStaticMarkup(<Card className="p-4">Account form</Card>)).toContain(
      'Account form',
    );
  });
});
