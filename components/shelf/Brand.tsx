export function PixbMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <PixbMark />
      PixB<span className="brand-dot">.</span>
    </span>
  );
}
