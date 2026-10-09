/**
 * 手寫作文照片：拍照或從相簿選，最多 2 張；選好立刻在前端縮圖（長邊 ≤1600 px、JPEG、每張 ≤1.2 MB），預覽後再上傳。
 * 原始照片不會離開這台裝置；上傳的是縮過、去掉 EXIF 的 JPEG。
 */
import { PHOTO_MAX_COUNT } from '@gsat/shared';
import { ArrowDownUp, Camera, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { PHOTO_QUALITY_MESSAGES, PhotoDecodeError, PhotoTooLargeError, formatBytes, photoQualityIssue, resizePhotoFile, type ResizedPhoto } from '../lib/photo';
import { Notice, secondaryButton } from './ui';

export interface PickedPhoto extends ResizedPhoto {
  key: string;
  name: string;
}

let photoSeq = 0;

export function PhotoPicker({ photos, onChange, disabled }: { photos: PickedPhoto[]; onChange: (photos: PickedPhoto[]) => void; disabled?: boolean }) {
  const baseId = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = PHOTO_MAX_COUNT - photos.length;

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setProcessing(true);
    const picked = Array.from(files).slice(0, remaining);
    const next = [...photos];
    try {
      for (const file of picked) {
        const resized = await resizePhotoFile(file);
        photoSeq += 1;
        next.push({ ...resized, key: `p${photoSeq}`, name: file.name });
      }
      if (files.length > remaining) setError(`最多 ${PHOTO_MAX_COUNT} 張，多選的照片沒有加入。`);
    } catch (err) {
      setError(err instanceof PhotoDecodeError || err instanceof PhotoTooLargeError ? err.message : '照片處理失敗，請換一張再試。');
    } finally {
      onChange(next);
      setProcessing(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const remove = (key: string) => {
    const target = photos.find((p) => p.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(photos.filter((p) => p.key !== key));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          ref={cameraRef}
          id={`${baseId}-camera`}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void addFiles(e.currentTarget.files)}
        />
        <input
          ref={galleryRef}
          id={`${baseId}-gallery`}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void addFiles(e.currentTarget.files)}
        />
        <button type="button" className={secondaryButton} disabled={disabled || processing || remaining <= 0} onClick={() => cameraRef.current?.click()}>
          <Camera aria-hidden="true" className="size-5" />
          拍照
        </button>
        <button type="button" className={secondaryButton} disabled={disabled || processing || remaining <= 0} onClick={() => galleryRef.current?.click()}>
          <ImagePlus aria-hidden="true" className="size-5" />
          從相簿選擇
        </button>
        {photos.length === 2 && (
          <button type="button" className={secondaryButton} disabled={disabled || processing} onClick={() => onChange([...photos].reverse())}>
            <ArrowDownUp aria-hidden="true" className="size-5" />
            對調順序
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        最多 {PHOTO_MAX_COUNT} 張（作文寫超過一頁時拍第 2 張），依順序辨識。光線充足、紙張平放、整頁入鏡，避免陰影與反光。
      </p>
      {processing && (
        <p role="status" className="text-sm text-muted">
          照片處理中…
        </p>
      )}
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
      {photos.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {photos.map((p, i) => {
            const issue = photoQualityIssue(p);
            return (
            <li key={p.key} className="min-w-0 rounded-xl border border-line p-2">
              <img src={p.previewUrl} alt={`第 ${i + 1} 張作文照片預覽`} className="max-h-80 w-full rounded-lg bg-surface-2 object-contain" />
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums text-muted">
                  第 {i + 1} 張・{p.width}×{p.height}・{formatBytes(p.blob.size)}
                  {p.originalBytes > p.blob.size ? `（原檔 ${formatBytes(p.originalBytes)}）` : ''}
                </span>
                <button type="button" onClick={() => remove(p.key)} disabled={disabled} className="inline-flex min-h-9 items-center gap-1 text-bad disabled:opacity-50">
                  <Trash2 aria-hidden="true" className="size-4" />
                  移除
                </button>
              </p>
              {issue && (
                <p role="alert" className="mt-2 rounded-lg border border-badge-fg/30 bg-badge-bg/60 px-3 py-2 text-sm">
                  {PHOTO_QUALITY_MESSAGES[issue]}。建議靠近一點、整頁入鏡重拍（手寫稿請直接拍紙本，不要用長截圖）。
                </p>
              )}
            </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
