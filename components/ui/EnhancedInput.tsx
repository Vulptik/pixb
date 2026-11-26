/**
 * Enhanced Input component with context menu for text operations
 */

'use client';

// React
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';

// PixB UI
import { Input as HeroInput } from '@/components/ui/primitives';
import { useTranslations } from 'next-intl';

// Icons
import { Copy, Scissors, Clipboard, Eye, EyeOff, MousePointer, Shuffle, X } from 'lucide-react';

// Components
import ContextMenu from '@/components/ui/ContextMenu';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

// Types
import { ContextMenuSection } from '@/types';
import { EnhancedInputProps } from '@/types';

// Utils
import { getInputClasses } from '@/lib/utils/styleUtils';
import { generatePassword } from '@/lib/utils/password';

const EnhancedInput = forwardRef<HTMLInputElement, EnhancedInputProps>(
  (
    {
      showContextMenu = true,
      showRevealToggle = false,
      confirmation = false,
      onRevealToggle,
      showPasswordStrength = false,
      showGenerateButton = false,
      onGenerate,
      passwordRules,
      className,
      type,
      endContent,
      onClear,
      isReadOnly,
      onChange,
      ...props
    },
    ref,
  ) => {
    const tc = useTranslations('common');
    const inputRef = useRef<HTMLInputElement>(null);
    const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0 });
    const [isRevealed, setIsRevealed] = useState(false);
    const [passwordValue, setPasswordValue] = useState('');

    useImperativeHandle(ref, () => inputRef.current!);

    // Sync password value with input value from props (for Formik integration)
    useEffect(() => {
      if (type === 'password' && showPasswordStrength) {
        setPasswordValue((props.value as string) || '');
      }
    }, [props.value, type, showPasswordStrength]);

    const classNames = getInputClasses();

    // Default password rules matching generatePassword function
    const defaultPasswordRules = useMemo(
      () => ({
        uppercase: true,
        lowercase: true,
        number: true,
        special: true,
        minimum: 8,
        ...passwordRules,
      }),
      [passwordRules],
    );

    // Combined onChange handler that tracks password value and calls original onChange
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        // Always track password value for password inputs when strength indicator is enabled
        if (type === 'password' && showPasswordStrength) {
          setPasswordValue(e.target.value);
        }
        if (onChange) {
          onChange(e);
        }
      },
      [onChange, type, showPasswordStrength],
    );

    // Handle password generation
    const handleGeneratePassword = useCallback(() => {
      if (onGenerate) {
        onGenerate();
      } else {
        // Default generation if no custom handler provided
        const newPassword = generatePassword();
        if (inputRef.current) {
          inputRef.current.value = newPassword;
          setPasswordValue(newPassword);

          // Create synthetic event for Formik
          const syntheticEvent = {
            target: inputRef.current,
            currentTarget: inputRef.current,
            type: 'change',
            preventDefault: () => {},
            stopPropagation: () => {},
          } as React.ChangeEvent<HTMLInputElement>;

          if (onChange) {
            onChange(syntheticEvent);
          }
        }
      }
    }, [onGenerate, onChange]);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        if (!showContextMenu) return;

        e.preventDefault();
        e.stopPropagation();

        setContextMenu({
          isOpen: true,
          x: e.clientX,
          y: e.clientY,
        });
      },
      [showContextMenu],
    );

    const handleSelectAll = useCallback(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, []);

    const handleCopy = useCallback(async () => {
      if (!inputRef.current) return;

      const selectedText = inputRef.current.value.substring(
        inputRef.current.selectionStart || 0,
        inputRef.current.selectionEnd || 0,
      );

      if (selectedText) {
        try {
          await navigator.clipboard.writeText(selectedText);
        } catch (error) {
          console.warn('Copy failed:', error);
        }
      }
    }, []);

    const handleCut = useCallback(async () => {
      const input = inputRef.current;
      if (!input) return;

      const selectedText = input.value.substring(
        input.selectionStart || 0,
        input.selectionEnd || 0,
      );

      if (selectedText) {
        try {
          await navigator.clipboard.writeText(selectedText);

          // Remove selected text and trigger onChange
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          const newValue = input.value.substring(0, start) + input.value.substring(end);

          // Update the input value
          input.value = newValue;

          // Create a synthetic event that Formik will recognize
          const syntheticEvent = {
            target: input,
            currentTarget: input,
            type: 'change',
            preventDefault: () => {},
            stopPropagation: () => {},
          } as React.ChangeEvent<HTMLInputElement>;

          // Call the onChange handler if it exists (from Formik)
          if (onChange) {
            onChange(syntheticEvent);
          }

          // Set cursor position
          input.setSelectionRange(start, start);
        } catch (error) {
          console.warn('Cut failed:', error);
        }
      }
    }, [onChange]);

    const handlePaste = useCallback(async () => {
      const input = inputRef.current;
      if (!input) return;

      input.focus();

      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          const currentValue = input.value;
          const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);

          // Update the input value
          input.value = newValue;

          // Create a synthetic event that Formik will recognize
          const syntheticEvent = {
            target: input,
            currentTarget: input,
            type: 'change',
            preventDefault: () => {},
            stopPropagation: () => {},
          } as React.ChangeEvent<HTMLInputElement>;

          // Call the onChange handler if it exists (from Formik)
          if (onChange) {
            onChange(syntheticEvent);
          }

          // Set cursor position
          input.setSelectionRange(start + text.length, start + text.length);
        }
      } catch (error) {
        console.warn('Paste failed:', error);
      }
    }, [onChange]);

    const handleRevealToggle = useCallback(() => {
      const newRevealed = !isRevealed;
      setIsRevealed(newRevealed);
      onRevealToggle?.(newRevealed);
    }, [isRevealed, onRevealToggle]);

    const contextMenuSections: ContextMenuSection[] = useMemo(() => {
      const sections: ContextMenuSection[] = [];

      // Text operations section
      const textOperations = [
        {
          label: tc('selectAll'),
          icon: <MousePointer size={16} />,
          onClick: handleSelectAll,
        },
        {
          label: tc('copy'),
          icon: <Copy size={16} />,
          onClick: handleCopy,
        },
      ];

      // Only add Cut and Paste for editable fields
      if (!isReadOnly) {
        textOperations.push(
          {
            label: tc('cut'),
            icon: <Scissors size={16} />,
            onClick: handleCut,
          },
          {
            label: tc('paste'),
            icon: <Clipboard size={16} />,
            onClick: handlePaste,
          },
        );
      }

      sections.push({
        items: textOperations,
      });

      // Reveal toggle section (only for password inputs)
      if (showRevealToggle && type === 'password') {
        sections.push({
          items: [
            {
              label: isRevealed ? tc('hide') : tc('reveal'),
              icon: isRevealed ? <EyeOff size={16} /> : <Eye size={16} />,
              onClick: handleRevealToggle,
            },
          ],
        });
      }

      return sections;
    }, [
      handleSelectAll,
      handleCopy,
      handleCut,
      handlePaste,
      showRevealToggle,
      type,
      isRevealed,
      handleRevealToggle,
      isReadOnly,
      tc,
    ]);

    // Determine the actual input type
    const actualType = useMemo(() => {
      if (type === 'password' && showRevealToggle && isRevealed) {
        return 'text';
      }
      return type;
    }, [type, showRevealToggle, isRevealed]);

    // Handle clear functionality with Formik integration
    const handleClear = useCallback(() => {
      // Update the DOM immediately
      if (inputRef.current) {
        inputRef.current.value = '';

        // Clear password value state if showing strength indicator
        if (type === 'password' && showPasswordStrength) {
          setPasswordValue('');
        }

        // Create a synthetic event for Formik
        const syntheticEvent = {
          target: inputRef.current,
          currentTarget: inputRef.current,
          type: 'change',
          preventDefault: () => {},
          stopPropagation: () => {},
        } as React.ChangeEvent<HTMLInputElement>;

        // Call Formik's onChange if it exists
        if (onChange) {
          onChange(syntheticEvent);
        }
      }

      // Call the original onClear handler (for URL params, etc.)
      if (onClear) {
        onClear();
      }
    }, [onChange, onClear, type, showPasswordStrength]);

    // Destructure isClearable, size, and variant from props to prevent them from being passed to PixB UI
    const { isClearable, size, variant, ...heroInputProps } = props;

    // Map unsupported sizes to supported ones
    const mappedSize = size === 'xl' ? 'lg' : size === 'full' ? 'lg' : size;

    // Map unsupported variants to supported ones
    const mappedVariant =
      variant === 'default'
        ? 'flat'
        : variant === 'outline'
          ? 'bordered'
          : variant === 'filled'
            ? 'flat'
            : variant;

    return (
      <>
        <HeroInput
          ref={inputRef}
          radius="sm"
          size={mappedSize}
          variant={mappedVariant}
          classNames={classNames}
          className={`enhanced-input ${className || ''}`}
          type={actualType}
          onContextMenu={handleContextMenu}
          onChange={handleChange}
          labelPlacement="outside"
          endContent={
            <>
              <div className="flex items-center gap-2">
                {(showGenerateButton || onGenerate) && (
                  <button
                    type="button"
                    aria-label={tc('generate')}
                    onClick={handleGeneratePassword}
                    className="hover:cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                  >
                    <Shuffle size={16} />
                  </button>
                )}
                {showPasswordStrength && (
                  <PasswordStrengthIndicator
                    password={(props.value as string) || passwordValue}
                    passwordRules={defaultPasswordRules}
                  />
                )}
                {isClearable && (props.value as string) !== '' && (
                  <button
                    type="button"
                    aria-label={tc('clear')}
                    onClick={handleClear}
                    className="hover:cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
                {showRevealToggle && type === 'password' && (
                  <button
                    type="button"
                    onClick={handleRevealToggle}
                    className="hover:cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                    aria-label={tc(
                      confirmation
                        ? isRevealed
                          ? 'hidePasswordConfirmation'
                          : 'showPasswordConfirmation'
                        : isRevealed
                          ? 'hidePassword'
                          : 'showPassword',
                    )}
                    aria-pressed={isRevealed}
                    aria-controls={props.id || props.name}
                  >
                    {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
                {endContent}
              </div>
            </>
          }
          id={props['id'] || props['name']}
          {...heroInputProps}
        />

        {showContextMenu && (
          <ContextMenu
            sections={contextMenuSections}
            isOpen={contextMenu.isOpen}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu({ ...contextMenu, isOpen: false })}
          />
        )}
      </>
    );
  },
);

EnhancedInput.displayName = 'EnhancedInput';

export default EnhancedInput;
