/**
 * Centralized styling utilities and constants.
 */

export const STYLE_CONSTANTS = {
  focusClasses: 'focus:outline-none focus:ring-0 focus:border-transparent',

  transitions: {
    default: 'transition-colors duration-150',
    fast: 'transition-colors duration-100',
    colors: 'transition-colors duration-150',
    transform: 'transition-transform duration-150',
  },

  borders: {
    default: 'border border-divider',
    focus: 'border-primary',
    error: 'border-danger/60',
  },

  shadows: {
    default: 'shadow-sm',
    hover: 'hover:shadow-md',
    focus: 'ring-2 ring-primary/20',
  },

  backgrounds: {
    content1: 'bg-content1',
    content2: 'bg-content2',
    content3: 'bg-content3',
    content4: 'bg-content4',
  },

  text: {
    primary: 'text-foreground',
    secondary: 'text-foreground/80',
    muted: 'text-foreground/60',
    error: 'text-danger',
    success: 'text-success',
    warning: 'text-warning',
  },
} as const;

export const getInputClasses = () => ({
  inputWrapper: `pixb-input-wrapper ${STYLE_CONSTANTS.backgrounds.content3} relative w-full inline-flex ${STYLE_CONSTANTS.shadows.default} tap-highlight-transparent ${STYLE_CONSTANTS.borders.default} data-[hover=true]:border-divider data-[focus-within=true]:${STYLE_CONSTANTS.borders.focus} data-[focus-within=true]:${STYLE_CONSTANTS.shadows.focus} data-[focus-visible=true]:${STYLE_CONSTANTS.borders.focus} data-[focus-visible=true]:${STYLE_CONSTANTS.shadows.focus} data-[invalid=true]:!bg-danger/10 data-[invalid=true]:${STYLE_CONSTANTS.borders.error} data-[invalid=true]:${STYLE_CONSTANTS.shadows.focus}`,
  innerWrapper: STYLE_CONSTANTS.text.primary,
  input: `w-full h-full bg-transparent outline-none placeholder:${STYLE_CONSTANTS.text.muted} ${STYLE_CONSTANTS.text.primary} text-base ${STYLE_CONSTANTS.focusClasses} !bg-transparent [outline:none] [box-shadow:none]`,
  clearButton: `${STYLE_CONSTANTS.text.muted} hover:${STYLE_CONSTANTS.text.secondary} ${STYLE_CONSTANTS.transitions.colors}`,
});

export const getCardClasses = (className = '') => `
  relative overflow-hidden rounded-lg ${STYLE_CONSTANTS.transitions.default}
  ${STYLE_CONSTANTS.backgrounds.content1}
  ${STYLE_CONSTANTS.borders.default}
  ${className}
`;
