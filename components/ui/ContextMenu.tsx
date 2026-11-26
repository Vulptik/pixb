/**
 * ContextMenu component for displaying custom right-click menus
 */

'use client';

// React
import { FC, JSX, useEffect, useMemo, useRef, useState, memo } from 'react';

// Third-party
import { createPortal } from 'react-dom';

// Contexts
import { usePortalContainer } from '@/lib/contexts/PortalContainerContext';
import { useContextMenu } from '@/lib/contexts/ContextMenuContext';

// Types
import { ContextMenuProps } from '@/types';

type Phase = 'closed' | 'measuring' | 'visible';

const ContextMenu: FC<ContextMenuProps> = ({
  sections,
  isOpen,
  position,
  onClose,
}): JSX.Element | null => {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const portalContainer = usePortalContainer();
  const [phase, setPhase] = useState<Phase>('closed');
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const { setIsContextMenuOpen } = useContextMenu();
  const onCloseRef = useRef(onClose);

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const allItemsRef = useRef(allItems);
  const focusedIndexRef = useRef(-1);
  const [focusedIndex, setFocusedIndexState] = useState(-1);

  const setFocusedIndex = (nextIndex: number) => {
    focusedIndexRef.current = nextIndex;
    setFocusedIndexState(nextIndex);
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    allItemsRef.current = allItems;
  }, [allItems]);

  useEffect(() => {
    focusedIndexRef.current = focusedIndex;
  }, [focusedIndex]);

  // Drive the phase machine from isOpen + position
  useEffect(() => {
    if (isOpen) {
      if (!menuRef.current?.contains(document.activeElement)) {
        openerRef.current = document.activeElement as HTMLElement | null;
      }
      // Always start from scratch: reset to raw cursor position, invisible, no transition
      setAdjustedPosition(position);
      setFocusedIndex(-1);
      setIsContextMenuOpen(true);
      setPhase('measuring');
    } else {
      setPhase('closed');
      setIsContextMenuOpen(false);
    }
  }, [isOpen, position, setIsContextMenuOpen]);

  // Once in measuring phase: measure, reposition, then fade in
  useEffect(() => {
    if (phase !== 'measuring') return;
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;
    if (x + width > vw) x = vw - width - 10;
    if (y + height > vh) y = vh - height - 10;
    if (x < 10) x = 10;
    if (y < 10) y = 10;

    setAdjustedPosition({ x, y });

    // Double RAF: first ensures the repositioned layout is committed,
    // second ensures the browser has painted it (giving a "from" state
    // for the opacity transition to fire correctly every time).
    let f2: number;
    const f1: number = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        setPhase('visible');
      });
    });

    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
    };
  }, [phase, position]);

  // Close on outside interaction from capture phase so component-level
  // stopPropagation cannot strand an open menu.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu) return;

      const target = event.target as Node | null;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const isInsideMenu = target ? menu.contains(target) || path.includes(menu) : false;

      if (!isInsideMenu) {
        onCloseRef.current();
      }
    };

    const handleScroll = () => onCloseRef.current();

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (activeElement !== openerRef.current && !menuRef.current?.contains(activeElement)) return;
      const currentItems = allItemsRef.current;
      const currentFocusedIndex = focusedIndexRef.current;
      const focusItem = (index: number) => {
        const item =
          menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index];
        item?.focus({ preventScroll: true });
      };

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          openerRef.current?.focus({ preventScroll: true });
          onCloseRef.current();
          break;
        case 'ArrowDown': {
          event.preventDefault();
          let next = currentFocusedIndex + 1;
          while (next < currentItems.length && currentItems[next].disabled) next++;
          if (next < currentItems.length) focusItem(next);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          let prev = currentFocusedIndex - 1;
          while (prev >= 0 && currentItems[prev].disabled) prev--;
          if (prev >= 0) focusItem(prev);
          break;
        }
        case 'Enter': {
          event.preventDefault();
          if (
            currentFocusedIndex >= 0 &&
            currentFocusedIndex < currentItems.length &&
            !currentItems[currentFocusedIndex].disabled
          ) {
            onCloseRef.current();
            requestAnimationFrame(() => currentItems[currentFocusedIndex].onClick());
          }
          break;
        }
      }
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    document.addEventListener('wheel', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      document.removeEventListener('wheel', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (phase === 'closed') return null;

  const isVisible = phase === 'visible';

  const getItemColorClasses = (variant?: string, disabled?: boolean) => {
    if (disabled) return 'opacity-40 cursor-not-allowed';
    switch (variant) {
      case 'danger':
        return 'cursor-pointer text-danger hover:bg-danger/10';
      case 'warning':
        return 'cursor-pointer text-warning hover:bg-warning/10';
      case 'primary':
        return 'cursor-pointer text-primary hover:bg-primary/10';
      default:
        return 'cursor-pointer text-foreground/80 hover:bg-content2 hover:text-foreground';
    }
  };

  const menuContent = (
    <div
      ref={menuRef}
      className="fixed z-9999"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        // No transition during measuring — only add it when going visible
        // so the browser has a clean "from: opacity 0" state to animate from
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        transition: isVisible ? 'opacity 200ms ease-out' : 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="min-w-45 bg-content1 border border-divider rounded-lg py-1" role="menu">
        {sections.map((section, sectionIndex) => {
          const sectionStartIndex = sections
            .slice(0, sectionIndex)
            .reduce((acc, s) => acc + s.items.length, 0);
          return (
            <div key={sectionIndex}>
              {sectionIndex > 0 && <div className="my-1 h-px bg-divider" role="separator" />}
              <div className="flex flex-col">
                {section.items.map((item, itemIndex) => {
                  const globalIndex = sectionStartIndex + itemIndex;
                  return (
                    <button
                      key={itemIndex}
                      role="menuitem"
                      onFocus={() => setFocusedIndex(globalIndex)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!item.disabled) {
                          onClose();
                          requestAnimationFrame(() => item.onClick());
                        }
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseUp={(e) => e.stopPropagation()}
                      disabled={item.disabled}
                      className={`
                        w-full px-3 py-1.5 text-left text-sm
                        flex items-center gap-2.5 transition-colors duration-100
                        ${getItemColorClasses(item.variant, item.disabled)}
                        ${globalIndex === focusedIndex ? 'bg-content2' : ''}
                      `}
                    >
                      {item.icon && (
                        <span className="shrink-0 w-4 h-4 [&>svg]:w-4 [&>svg]:h-4">
                          {item.icon}
                        </span>
                      )}
                      <span className="flex-1">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return createPortal(menuContent, portalContainer ?? document.body);
};

export default memo(ContextMenu);
