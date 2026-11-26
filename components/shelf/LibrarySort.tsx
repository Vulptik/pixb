'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function LibrarySort({
  value,
  onChange,
}: {
  value: 'newest' | 'oldest';
  onChange: (value: 'newest' | 'oldest') => void;
}) {
  const t = useTranslations('shelf');
  const label = (order: 'newest' | 'oldest') => t(order === 'newest' ? 'latest' : 'oldest');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="library-sort-trigger"
          aria-label={t('sortWithValue', { value: label(value) })}
        >
          <span>{label(value)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="library-sort-menu"
          align="end"
          sideOffset={6}
          collisionPadding={12}
        >
          <DropdownMenu.RadioGroup
            value={value}
            aria-label={t('sort')}
            onValueChange={(order) => {
              if (order === 'newest' || order === 'oldest') onChange(order);
            }}
          >
            {(['newest', 'oldest'] as const).map((order) => (
              <DropdownMenu.RadioItem className="library-sort-option" key={order} value={order}>
                {label(order)}
                <DropdownMenu.ItemIndicator>
                  <Check size={15} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
