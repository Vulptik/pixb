'use client';

import { PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, ZoomIn, ZoomOut } from 'lucide-react';

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Slider,
} from '@/components/ui/primitives';
import { showToast } from '@/lib/utils/helpers';

type Point = { x: number; y: number };

type AvatarCropModalProps = {
  file: File | null;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

const OUTPUT_SIZE = 512;
const CROP_INSET_RATIO = 0.06;

export default function AvatarCropModal({ file, onCancel, onConfirm }: AvatarCropModalProps) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState(320);
  const attachViewport = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointer: Point; offset: Point } | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!viewportElement) return;
    let previousSize = viewportElement.clientWidth || 320;
    setViewportSize(previousSize);
    const resize = () => {
      const nextSize = viewportElement.clientWidth;
      if (!nextSize || nextSize === previousSize) return;
      const ratio = nextSize / previousSize;
      previousSize = nextSize;
      dragRef.current = null;
      setViewportSize(nextSize);
      setOffset((current) => ({ x: current.x * ratio, y: current.y * ratio }));
    };
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [viewportElement]);

  useEffect(() => {
    if (!file) {
      setImageUrl('');
      return;
    }

    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const getGeometry = useCallback(
    (nextZoom = zoom) => {
      const currentViewportSize = viewportRef.current?.clientWidth || viewportSize;
      const cropSize = currentViewportSize * (1 - CROP_INSET_RATIO * 2);
      const baseScale = imageSize.width
        ? Math.max(cropSize / imageSize.width, cropSize / imageSize.height)
        : 1;
      const scale = baseScale * nextZoom;
      return {
        viewportSize: currentViewportSize,
        cropSize,
        scale,
        width: imageSize.width * scale,
        height: imageSize.height * scale,
      };
    },
    [imageSize, zoom, viewportSize],
  );

  const constrainOffset = useCallback(
    (next: Point, nextZoom = zoom): Point => {
      const geometry = getGeometry(nextZoom);
      const maxX = Math.max(0, (geometry.width - geometry.cropSize) / 2);
      const maxY = Math.max(0, (geometry.height - geometry.cropSize) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [getGeometry, zoom],
  );

  const handleZoom = (value: number | number[]) => {
    const nextZoom = Array.isArray(value) ? value[0] : value;
    setZoom(nextZoom);
    setOffset((current) => constrainOffset(current, nextZoom));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointer: { x: event.clientX, y: event.clientY },
      offset,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setOffset(
      constrainOffset({
        x: dragRef.current.offset.x + event.clientX - dragRef.current.pointer.x,
        y: dragRef.current.offset.y + event.clientY - dragRef.current.pointer.y,
      }),
    );
  };

  const handleConfirm = async () => {
    const image = imageRef.current;
    if (!file || !image || !imageSize.width) return;

    setIsSaving(true);
    try {
      const { viewportSize, cropSize, scale, width, height } = getGeometry();
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available');

      const cropInset = viewportSize * CROP_INSET_RATIO;
      const outputScale = OUTPUT_SIZE / cropSize;
      context.drawImage(
        image,
        (viewportSize / 2 - width / 2 + offset.x - cropInset) * outputScale,
        (viewportSize / 2 - height / 2 + offset.y - cropInset) * outputScale,
        imageSize.width * scale * outputScale,
        imageSize.height * scale * outputScale,
      );

      const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('Unable to crop image'))),
          outputType,
          0.92,
        );
      });
      const extension = outputType === 'image/png' ? 'png' : 'jpg';
      onConfirm(new File([blob], `avatar.${extension}`, { type: outputType }));
    } catch {
      showToast(t('avatarCropFailed'), 'danger');
    } finally {
      setIsSaving(false);
    }
  };

  const geometry = getGeometry();

  return (
    <Modal
      isOpen={!!file}
      onClose={onCancel}
      size="md"
      isDismissable={!isSaving}
      mobilePresentation="fullscreen"
    >
      <ModalContent className="avatar-crop-editor">
        <ModalHeader>{t('adjustAvatar')}</ModalHeader>
        <ModalBody className="avatar-crop-body flex flex-col items-center gap-5">
          <p className="avatar-crop-description text-center text-foreground/60">
            {t('adjustAvatarDescription')}
          </p>
          <div
            ref={attachViewport}
            className="avatar-crop-viewport relative aspect-square w-full max-w-90 cursor-grab touch-none select-none overflow-hidden bg-black active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
          >
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                draggable={false}
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                style={{
                  width: geometry.width,
                  height: geometry.height,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-[6%] rounded-md border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
          </div>
          <Slider
            id="avatar-zoom"
            label={t('zoomAvatar')}
            minValue={1}
            maxValue={3}
            step={0.01}
            value={zoom}
            onChange={handleZoom}
            startContent={<ZoomOut aria-hidden="true" size={18} />}
            endContent={<ZoomIn aria-hidden="true" size={18} />}
            className="avatar-crop-zoom max-w-90"
          />
          <span className="sr-only" aria-live="polite">
            {t('zoomAvatarValue', { value: Math.round(zoom * 100) })}
          </span>
        </ModalBody>
        <ModalFooter>
          <Button onPress={onCancel} isDisabled={isSaving}>
            {tc('cancel')}
          </Button>
          <Button
            color="primary"
            startContent={<ImageIcon size={16} />}
            onPress={() => void handleConfirm()}
            isLoading={isSaving}
            isDisabled={!imageSize.width}
          >
            {t('applyAvatar')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
