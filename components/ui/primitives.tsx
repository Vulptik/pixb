'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { createPortal } from 'react-dom';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Check, Info, TriangleAlert, UserIcon, X } from 'lucide-react';
import React, {
  createContext,
  forwardRef,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { LoadingMark } from './LoadingMark';

type Color = 'default' | 'foreground' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'full';
type Variant = 'solid' | 'flat' | 'bordered' | 'light' | 'ghost' | 'shadow' | 'faded' | 'filled';

const colorClasses: Record<Color, { solid: string; flat: string; text: string; border: string }> = {
  default: {
    solid: 'bg-content3 text-foreground hover:bg-content4',
    flat: 'bg-content2 text-foreground hover:bg-content3',
    text: 'text-foreground',
    border: 'border-divider',
  },
  foreground: {
    solid: 'bg-foreground text-background hover:bg-foreground/90',
    flat: 'bg-foreground/10 text-foreground hover:bg-foreground/15',
    text: 'text-foreground',
    border: 'border-foreground/25',
  },
  primary: {
    solid: 'bg-primary text-primary-foreground hover:bg-primary/90',
    flat: 'bg-primary/10 text-primary hover:bg-primary/15',
    text: 'text-primary',
    border: 'border-primary/35',
  },
  secondary: {
    solid: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
    flat: 'bg-secondary/10 text-secondary hover:bg-secondary/15',
    text: 'text-secondary',
    border: 'border-secondary/35',
  },
  success: {
    solid: 'bg-success text-success-foreground hover:bg-success/90',
    flat: 'bg-success/10 text-success hover:bg-success/15',
    text: 'text-success',
    border: 'border-success/35',
  },
  warning: {
    solid: 'bg-warning text-warning-foreground hover:bg-warning/90',
    flat: 'bg-warning/10 text-warning hover:bg-warning/15',
    text: 'text-warning',
    border: 'border-warning/35',
  },
  danger: {
    solid: 'bg-danger text-danger-foreground hover:bg-danger/90',
    flat: 'bg-danger/10 text-danger hover:bg-danger/15',
    text: 'text-danger',
    border: 'border-danger/35',
  },
};

const sizeClasses: Record<Exclude<Size, 'xl' | 'full'>, string> = {
  sm: 'h-9 min-w-9 px-3 text-sm',
  md: 'h-10 min-w-10 px-4 text-base',
  lg: 'h-11 min-w-11 px-5 text-base',
};

const radiusClasses: Record<string, string> = {
  none: 'rounded-none',
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  full: 'rounded-full',
};

const mapSize = (size?: Size): 'sm' | 'md' | 'lg' => {
  if (size === 'sm' || size === 'md' || size === 'lg') return size;
  return 'md';
};

const mapColor = (color?: Color): Color => color ?? 'default';

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'color' | 'disabled'
> {
  as?: React.ElementType;
  color?: Color;
  variant?: Variant;
  size?: Size;
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  fullWidth?: boolean;
  isDisabled?: boolean;
  isLoading?: boolean;
  isIconOnly?: boolean;
  startContent?: ReactNode;
  endContent?: ReactNode;
  onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  href?: string;
  target?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      color,
      variant = 'solid',
      size = 'md',
      radius = 'sm',
      fullWidth,
      isDisabled,
      isLoading,
      isIconOnly,
      startContent,
      endContent,
      onPress,
      onClick,
      as,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const Component = as ?? 'button';
    const resolvedColor = mapColor(color);
    const resolvedSize = mapSize(size);
    const style =
      variant === 'bordered' || variant === 'ghost' || variant === 'faded'
        ? `border ${colorClasses[resolvedColor].border} bg-transparent ${colorClasses[resolvedColor].text} hover:bg-content2`
        : variant === 'flat' || variant === 'light'
          ? colorClasses[resolvedColor].flat
          : colorClasses[resolvedColor].solid;

    return (
      <Component
        ref={ref}
        type={type}
        disabled={isDisabled || isLoading}
        aria-busy={isLoading || undefined}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) onPress?.(event);
        }}
        className={clsx(
          'inline-flex shrink-0 items-center justify-center gap-2 font-medium outline-none transition-colors duration-150',
          'enabled:cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
          radiusClasses[radius],
          isIconOnly ? 'h-9 w-9 min-w-9 p-0' : sizeClasses[resolvedSize],
          fullWidth && 'w-full',
          style,
          className,
        )}
        {...props}
      >
        {isLoading ? <LoadingMark size={18} /> : startContent}
        {!isIconOnly && children}
        {isIconOnly ? !isLoading && children : endContent}
      </Component>
    );
  },
);
Button.displayName = 'Button';

const Spinner = ({
  size = 'md',
  color = 'primary',
  className,
}: {
  size?: Size;
  color?: Color;
  variant?: string;
  className?: string;
}) => {
  const px = size === 'sm' ? 16 : size === 'lg' ? 32 : 24;
  return <LoadingMark size={px} className={clsx(colorClasses[mapColor(color)].text, className)} />;
};

export const Alert = ({
  children,
  color = 'default',
  className,
}: {
  children: ReactNode;
  color?: Color;
  variant?: Variant;
  className?: string;
}) => {
  const resolvedColor = mapColor(color);
  return (
    <div
      role="alert"
      className={clsx(
        'rounded-lg border px-3 py-2 text-sm',
        colorClasses[resolvedColor].flat,
        colorClasses[resolvedColor].border,
        className,
      )}
    >
      {children}
    </div>
  );
};

type AvatarProps = {
  src?: string | null;
  name?: string;
  size?: Size;
  radius?: string;
  color?: Color;
  isLoading?: boolean;
  as?: React.ElementType;
  spinner?: ReactNode;
  onPress?: () => void;
  className?: string;
  classNames?: Record<string, string>;
};

const Avatar = ({
  src,
  name,
  className,
  classNames,
  isLoading,
  as: _as,
  spinner,
  onPress,
  ..._props
}: AvatarProps) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [src]);

  return (
    <span
      onClick={onPress}
      className={clsx(
        'inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-content3 text-sm font-semibold text-foreground',
        onPress && 'cursor-pointer',
        classNames?.base,
        className,
      )}
    >
      {isLoading ? (
        spinner || <Spinner size="sm" />
      ) : src && !imageError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name || ''}
          onError={() => setImageError(true)}
          className={clsx('h-full w-full object-cover', classNames?.img)}
        />
      ) : (
        <UserIcon
          aria-hidden="true"
          className="h-[55%] w-[55%] text-foreground/60 transition-colors duration-300 group-hover:text-foreground"
        />
      )}
    </span>
  );
};
export { Avatar };

export interface TextInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'color' | 'disabled'
> {
  label?: ReactNode;
  labelPlacement?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  isInvalid?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  isClearable?: boolean;
  isRequired?: boolean;
  isMultiline?: boolean;
  onClear?: () => void;
  onValueChange?: (value: string) => void;
  startContent?: ReactNode;
  endContent?: ReactNode;
  classNames?: Record<string, string>;
  color?: Color;
  size?: Size;
  variant?: Variant;
  radius?: string;
}

export type InputProps = TextInputProps;

export const Input = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      description,
      errorMessage,
      isInvalid,
      isDisabled,
      isReadOnly,
      startContent,
      endContent,
      className,
      classNames,
      id,
      color,
      labelPlacement: _labelPlacement,
      isClearable: _isClearable,
      onClear: _onClear,
      size: _size,
      variant: _variant,
      radius: _radius,
      isRequired,
      onValueChange,
      onChange,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div
        className={clsx('group flex w-full flex-col gap-1.5', className)}
        data-invalid={isInvalid || color === 'danger' ? 'true' : undefined}
      >
        {label && (
          <label
            htmlFor={inputId}
            className={clsx('text-sm font-medium text-foreground', classNames?.label)}
          >
            {label}
          </label>
        )}
        <div
          className={clsx(
            'pixb-input-wrapper flex min-h-9 w-full items-center gap-2 rounded-md border border-divider px-3 py-2 transition-colors',
            'focus-within:border-primary focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-primary',
            (isInvalid || color === 'danger') && 'border-danger/60 bg-danger/10',
            classNames?.inputWrapper,
          )}
        >
          {startContent}
          <input
            ref={ref}
            id={inputId}
            disabled={isDisabled}
            readOnly={isReadOnly}
            required={isRequired}
            className={clsx(
              'min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground/60 disabled:opacity-50',
              classNames?.input,
            )}
            onChange={(event) => {
              onChange?.(event);
              onValueChange?.(event.currentTarget.value);
            }}
            {...props}
            aria-invalid={
              props['aria-invalid'] ??
              (!!isInvalid || !!errorMessage || color === 'danger' || undefined)
            }
            aria-describedby={
              [props['aria-describedby'], errorMessage || description ? `${inputId}-help` : '']
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          {endContent}
        </div>
        {(errorMessage || description) && (
          <div
            id={`${inputId}-help`}
            className={clsx(
              'text-sm',
              errorMessage && 'form-field-error',
              errorMessage || isInvalid ? 'text-danger' : 'text-foreground/60',
              classNames?.helperWrapper,
            )}
          >
            {errorMessage || description}
          </div>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';

export const Checkbox = forwardRef<
  HTMLButtonElement,
  {
    isSelected?: boolean;
    defaultSelected?: boolean;
    onValueChange?: (selected: boolean) => void;
    isDisabled?: boolean;
    isIndeterminate?: boolean;
    color?: Color;
    size?: Size;
    onChange?: () => void;
    className?: string;
    classNames?: Record<string, string>;
    children?: ReactNode;
  }
>(
  (
    {
      isSelected,
      defaultSelected,
      onValueChange,
      isDisabled,
      className,
      classNames,
      children,
      ...props
    },
    ref,
  ) => (
    <label
      className={clsx(
        'inline-flex items-center gap-2 text-sm text-foreground',
        isDisabled && 'opacity-50',
        className,
      )}
    >
      <CheckboxPrimitive.Root
        ref={ref}
        checked={isSelected}
        defaultChecked={defaultSelected}
        onCheckedChange={(checked) => onValueChange?.(checked === true)}
        onClick={() => {
          const onChange = (props as { onChange?: () => void }).onChange;
          onChange?.();
        }}
        disabled={isDisabled}
        className={clsx(
          'pixb-checkbox flex h-4 w-4 items-center justify-center rounded border border-divider bg-content3 text-primary outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary',
          classNames?.wrapper,
        )}
      >
        <CheckboxPrimitive.Indicator className="pixb-checkbox-indicator">
          <Check size={12} strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {children}
    </label>
  ),
);
Checkbox.displayName = 'Checkbox';

type SliderProps = {
  value?: number | number[];
  defaultValue?: number | number[];
  onChange?: (value: number | number[]) => void;
  onChangeEnd?: () => void;
  min?: number;
  max?: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
  isDisabled?: boolean;
  className?: string;
  classNames?: Record<string, string>;
  label?: ReactNode;
  startContent?: ReactNode;
  endContent?: ReactNode;
  getValue?: (value: number | number[]) => ReactNode;
  id?: string;
};

const Slider = ({
  value,
  defaultValue,
  onChange,
  onChangeEnd,
  min,
  max,
  minValue,
  maxValue,
  step = 1,
  isDisabled,
  className,
  classNames,
  label,
  startContent,
  endContent,
  getValue,
  id,
}: SliderProps) => {
  const normalizedValue = typeof value === 'number' ? [value] : value;
  const normalizedDefault = typeof defaultValue === 'number' ? [defaultValue] : defaultValue;
  const resolvedMin = min ?? minValue ?? 0;
  const resolvedMax = max ?? maxValue ?? 100;
  return (
    <div className={clsx('flex w-full flex-col gap-2', className)}>
      {(label || getValue) && (
        <div className="flex items-center justify-between gap-3 text-sm text-foreground">
          <label htmlFor={id}>{label}</label>
          {getValue && (
            <span className="text-sm text-foreground/60">{getValue(value ?? resolvedMin)}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        {startContent}
        <SliderPrimitive.Root
          id={id}
          value={normalizedValue}
          defaultValue={normalizedDefault}
          min={resolvedMin}
          max={resolvedMax}
          step={step}
          disabled={isDisabled}
          onValueChange={(next) => onChange?.(next.length === 1 ? next[0] : next)}
          onValueCommit={onChangeEnd}
          className={clsx(
            'relative flex h-5 w-full touch-none select-none items-center',
            classNames?.base,
          )}
        >
          <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-content3">
            <SliderPrimitive.Range className="absolute h-full bg-primary" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary bg-content1 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary" />
        </SliderPrimitive.Root>
        {endContent}
      </div>
    </div>
  );
};
export { Slider };

type ModalContextValue = {
  size?: string;
  mobilePresentation?: 'sheet' | 'fullscreen';
  classNames?: Record<string, string>;
  isDismissable?: boolean;
  onDismiss?: () => void;
};
const ModalContext = createContext<ModalContextValue>({});

type ModalProps = {
  children: ReactNode;
  isOpen: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  size?: string;
  mobilePresentation?: 'sheet' | 'fullscreen';
  backdrop?: string;
  placement?: string;
  scrollBehavior?: string;
  isDismissable?: boolean;
  classNames?: Record<string, string>;
};

const Modal = ({
  children,
  isOpen,
  onClose,
  onOpenChange,
  size,
  mobilePresentation,
  classNames,
  isDismissable = true,
}: ModalProps) => (
  <DialogPrimitive.Root
    open={isOpen}
    onOpenChange={(open) => {
      onOpenChange?.(open);
      if (!open) onClose?.();
    }}
  >
    <ModalContext.Provider
      value={{
        size,
        mobilePresentation,
        classNames,
        isDismissable,
        onDismiss: () => {
          onOpenChange?.(false);
          onClose?.();
        },
      }}
    >
      {children}
    </ModalContext.Provider>
  </DialogPrimitive.Root>
);
export { Modal };

const modalSizeClass = (size?: string) =>
  size === 'sm'
    ? 'max-w-md'
    : size === 'md'
      ? 'max-w-lg'
      : size === 'xl'
        ? 'max-w-3xl'
        : size === 'full'
          ? 'max-w-[calc(100vw-2rem)]'
          : 'max-w-2xl';

export const ModalContent = ({
  children,
  className,
  onClick,
  onDoubleClick,
  onMouseDown,
  onPointerDown,
  onPointerDownOutside,
  onInteractOutside,
  onEscapeKeyDown,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) => {
  const { size, mobilePresentation, classNames, isDismissable, onDismiss } =
    useContext(ModalContext);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(
    <>
      <DialogPrimitive.Overlay
        className={clsx('pixb-modal-overlay fixed inset-0 z-50', classNames?.backdrop)}
        onClick={(event) => {
          event.stopPropagation();
          if (isDismissable) onDismiss?.();
        }}
      />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        data-mobile-presentation={mobilePresentation}
        className={clsx(
          'pixb-modal-content fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-divider bg-content1 text-foreground outline-none',
          modalSizeClass(size),
          classNames?.base,
          classNames?.wrapper,
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          onDoubleClick?.(event);
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          onMouseDown?.(event);
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          event.stopPropagation();
        }}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          if (!isDismissable) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (!isDismissable) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (!isDismissable) event.preventDefault();
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </>,
    document.body,
  );
};

export const ModalHeader = ({
  children,
  className,
  hideCloseButton = false,
}: {
  children: ReactNode;
  className?: string;
  hideCloseButton?: boolean;
}) => {
  const tc = useTranslations('common');

  return (
    <DialogPrimitive.Title
      className={clsx(
        'pixb-modal-header flex items-center gap-3 border-b border-divider px-5 py-4 text-base font-semibold text-foreground',
        className,
      )}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button
            isIconOnly
            variant="light"
            size="sm"
            aria-label={tc('close')}
            className="-mr-2 ml-auto"
          >
            <X size={18} />
          </Button>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Title>
  );
};
export const ModalBody = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={clsx(
      'pixb-modal-body flex-1 overflow-auto px-5 py-4 text-sm text-foreground',
      className,
    )}
  >
    {children}
  </div>
);
export const ModalFooter = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={clsx(
      'pixb-modal-footer flex justify-end gap-2 border-t border-divider px-5 py-4',
      className,
    )}
  >
    <div className="dialog-actions">{children}</div>
  </div>
);

export const useDisclosure = (initialOpen = false) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const onOpen = useCallback(() => setIsOpen(true), []);
  const onClose = useCallback(() => setIsOpen(false), []);
  const onOpenChange = useCallback((open?: boolean) => {
    setIsOpen((current) => (typeof open === 'boolean' ? open : !current));
  }, []);
  const getButtonProps = useCallback((props: Record<string, unknown> = {}) => props, []);
  const getDisclosureProps = useCallback((props: Record<string, unknown> = {}) => props, []);
  return {
    isOpen,
    onOpen,
    onClose,
    onOpenChange,
    isControlled: false,
    getButtonProps,
    getDisclosureProps,
  };
};

export type ToastColor = Color;
export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  color?: ToastColor;
  icon?: ReactNode;
  timeout?: number;
};

type ToastPhase = 'entering' | 'visible' | 'exiting';
type ToastRecord = ToastOptions & { id: number; phase: ToastPhase };
type ToastPayload = ToastOptions & { id: number };
let toastId = 0;
let toastListeners: Array<(toast: ToastPayload) => void> = [];

type ToastPlacement = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center' | 'bottom-left';
type ToastProviderProps = {
  maxVisibleToasts?: number;
  placement?: ToastPlacement;
  toastOffset?: number;
};

const toastPlacementClasses: Record<ToastPlacement, string> = {
  'top-right': 'right-4 items-end',
  'top-center': 'left-1/2 -translate-x-1/2 items-center',
  'bottom-right': 'right-4 items-end',
  'bottom-center': 'left-1/2 -translate-x-1/2 items-center',
  'bottom-left': 'left-4 items-start',
};

export const addToast = (toast: ToastOptions) => {
  const record = { ...toast, id: ++toastId };
  toastListeners.forEach((listener) => listener(record));
};

export const ToastProvider = ({
  maxVisibleToasts = 3,
  placement = 'bottom-center',
  toastOffset = 28,
}: ToastProviderProps) => {
  const t = useTranslations('common');
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const timers = useRef(new Set<number>());
  const frames = useRef(new Set<number>());
  const lifetimes = useRef(new Map<number, number>());
  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
    return timer;
  }, []);
  const nextFrame = useCallback((callback: () => void) => {
    const frame = requestAnimationFrame(() => {
      frames.current.delete(frame);
      callback();
    });
    frames.current.add(frame);
  }, []);
  useEffect(() => {
    setPortalContainer(document.body);
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      frames.current.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, []);
  const placementClass = toastPlacementClasses[placement] ?? toastPlacementClasses['bottom-center'];
  const isTopPlacement = placement.startsWith('top');

  const dismissToast = useCallback(
    (toastIdToDismiss: number) => {
      const lifetime = lifetimes.current.get(toastIdToDismiss);
      if (lifetime !== undefined) {
        clearTimeout(lifetime);
        timers.current.delete(lifetime);
        lifetimes.current.delete(toastIdToDismiss);
      }
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setToasts((current) => current.filter((item) => item.id !== toastIdToDismiss));
        return;
      }
      setToasts((current) =>
        current.map((toast) =>
          toast.id === toastIdToDismiss && toast.phase !== 'exiting'
            ? { ...toast, phase: 'exiting' }
            : toast,
        ),
      );

      schedule(() => {
        setToasts((current) => current.filter((item) => item.id !== toastIdToDismiss));
      }, 240);
    },
    [schedule],
  );

  useEffect(() => {
    const listener = (toast: ToastPayload) => {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const toastWithPhase: ToastRecord = { ...toast, phase: reduced ? 'visible' : 'entering' };

      setToasts((current) => [...current, toastWithPhase].slice(-maxVisibleToasts));
      if (!reduced)
        nextFrame(() => {
          nextFrame(() => {
            setToasts((current) =>
              current.map((item) =>
                item.id === toast.id && item.phase === 'entering'
                  ? { ...item, phase: 'visible' }
                  : item,
              ),
            );
          });
        });
      const lifetime = schedule(() => {
        dismissToast(toast.id);
      }, toast.timeout ?? 4500);
      lifetimes.current.set(toast.id, lifetime);
    };
    toastListeners = [...toastListeners, listener];
    return () => {
      toastListeners = toastListeners.filter((item) => item !== listener);
    };
  }, [dismissToast, maxVisibleToasts, schedule, nextFrame]);

  // Animated ancestors establish a containing block for fixed descendants.
  // Keep viewport notifications outside page transitions and clipping surfaces.
  if (!portalContainer) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'pixb-toast-viewport pointer-events-none fixed z-9999 flex flex-col gap-2.5',
        placementClass,
      )}
      data-placement={placement}
      style={
        {
          '--toast-offset': `${toastOffset}px`,
          [isTopPlacement ? 'top' : 'bottom']: isTopPlacement
            ? `calc(${toastOffset}px + env(safe-area-inset-top))`
            : undefined,
        } as React.CSSProperties
      }
    >
      {toasts.map((toast) => {
        const color = mapColor(toast.color);
        const Icon =
          color === 'success'
            ? Check
            : color === 'danger' || color === 'warning'
              ? TriangleAlert
              : Info;
        const pause = () => {
          const lifetime = lifetimes.current.get(toast.id);
          if (lifetime !== undefined) {
            clearTimeout(lifetime);
            timers.current.delete(lifetime);
            lifetimes.current.delete(toast.id);
          }
        };
        const resume = () => {
          if (toast.phase === 'exiting') return;
          pause();
          lifetimes.current.set(
            toast.id,
            schedule(() => dismissToast(toast.id), toast.timeout ?? 4500),
          );
        };
        return (
          <div
            key={toast.id}
            className={clsx('pixb-toast', `pixb-toast-${toast.phase}`)}
            data-placement={placement}
            data-color={color}
            onMouseEnter={pause}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) resume();
            }}
            onFocus={pause}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(':hover')
              )
                resume();
            }}
            inert={toast.phase === 'exiting'}
            aria-hidden={toast.phase === 'exiting' || undefined}
          >
            <div className="pixb-toast-icon" aria-hidden="true">
              {toast.icon ?? <Icon size={18} strokeWidth={1.8} />}
            </div>
            <div className="pixb-toast-copy">
              <div className="pixb-toast-title">{toast.title}</div>
              {toast.description && (
                <div className="pixb-toast-description">{toast.description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="pixb-toast-close"
              aria-label={t('close')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    portalContainer,
  );
};
