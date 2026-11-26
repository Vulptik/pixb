/** PixB's shared Flow loader: spin, breathe, ripple, then tile turns. */
export function LoadingMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`pixb-loader-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-9 16 16)">
        <rect x="11.1" y="11.1" width="9.8" height="9.8" rx="2.8" />
        <rect x="11.1" y="11.1" width="9.8" height="9.8" rx="2.8" />
        <rect x="11.1" y="11.1" width="9.8" height="9.8" rx="2.8" />
        <rect x="11.1" y="11.1" width="9.8" height="9.8" rx="2.8" />
      </g>
    </svg>
  );
}
