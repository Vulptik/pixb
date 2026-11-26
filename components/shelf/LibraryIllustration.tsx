import { ImagePlus } from 'lucide-react';

export function LibraryIllustration() {
  return (
    <div className="library-illustration" aria-hidden="true">
      <span className="library-illustration-card">
        <ImagePlus size={36} strokeWidth={1.2} />
      </span>
    </div>
  );
}
