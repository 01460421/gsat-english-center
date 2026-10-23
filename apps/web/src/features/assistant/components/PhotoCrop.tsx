/**
 * 拍照問題目的框選畫面（docs/design/learning-assistant.md §1.6 第 2 步、§1.11、§5.2）：只框要問的題目。
 *
 *   - 在照片上拖曳框出範圍（滑鼠、手指都可以），或用四個滑桿「裁掉上方／下方／左邊／右邊 %」（鍵盤可以操作，
 *     可存取名稱帶目前的 %）；「使用整張」恢復成整張。
 *   - 框外的部分變暗；框選的數值由 lib/crop.ts 的純函式處理（至少留 10%）。
 *   - 「確定框選」：從原圖裁出那一塊，再縮圖（長邊 ≤ 1600 px、≤ 1.2 MB、去 EXIF）交給上一層；原始照片不會離開這台裝置。
 * 照片只用 object URL 在這台裝置預覽；元件卸載時釋放。
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PhotoDecodeError, PhotoTooLargeError, resizePhotoFile, type ResizedPhoto } from '../../writing/lib/photo';
import { clampInsets, cropPhotoFile, FULL_PHOTO, insetsFromDrag, isFullPhoto, type CropInsets } from '../lib/crop';
import { primaryBtn, secondaryBtn } from './parts';

const SIDES: Array<{ key: keyof CropInsets; label: string }> = [
  { key: 'top', label: '裁掉上方' },
  { key: 'bottom', label: '裁掉下方' },
  { key: 'left', label: '裁掉左邊' },
  { key: 'right', label: '裁掉右邊' },
];

export function PhotoCrop({
  file,
  index,
  onDone,
  onCancel,
  crop = cropPhotoFile,
  resize = resizePhotoFile,
}: {
  file: File;
  /** 第幾張（1 或 2）。 */
  index: number;
  onDone: (photo: ResizedPhoto) => void;
  onCancel: () => void;
  /** 測試注入（jsdom 沒有 canvas）。 */
  crop?: typeof cropPhotoFile;
  resize?: typeof resizePhotoFile;
}) {
  const id = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [insets, setInsets] = useState<CropInsets>(FULL_PHOTO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; pointer: number } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  /** 指標位置 → 圖片框裡的 0–1 座標。 */
  const at = (e: ReactPointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    const p = at(e);
    if (!p) return;
    dragRef.current = { ...p, pointer: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || start.pointer !== e.pointerId) return;
    const p = at(e);
    // 移動太少（點一下）不改框，避免誤觸把框縮成最小。
    if (p && (Math.abs(p.x - start.x) > 0.02 || Math.abs(p.y - start.y) > 0.02)) setInsets(insetsFromDrag(start, p));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const cropped = await crop(file, insets);
      onDone(await resize(cropped));
    } catch (err) {
      setError(err instanceof PhotoDecodeError || err instanceof PhotoTooLargeError ? err.message : '照片處理失敗，請換一張再試。');
      setBusy(false);
    }
  };

  const keep = { left: insets.left, top: insets.top, width: 100 - insets.left - insets.right, height: 100 - insets.top - insets.bottom };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        框選第 {index} 張照片
      </h2>
      <p className="text-[0.95rem]">
        只框<strong>要問的題目</strong>（題目、選項、你的作答與它的文章）。不要框到解答、詳解、評分說明、範文，也不要框到姓名、學號或學校。
      </p>
      {broken ? (
        <p role="alert" className="rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-sm">
          這台裝置無法預覽這張照片（可能是 HEIC 格式）。請改選 JPEG 或 PNG 照片，或用相機重新拍一張。
        </p>
      ) : (
        <div className="flex justify-center">
          <div
            ref={boxRef}
            className="relative inline-block max-w-full cursor-crosshair touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid="photo-crop-box"
          >
            {url && <img src={url} alt={`第 ${index} 張照片（框選中）`} draggable={false} onError={() => setBroken(true)} className="block max-h-[60vh] max-w-full rounded-lg bg-surface-2" />}
            {/* 框外變暗：四塊半透明的遮罩；框本身一圈實線。 */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bg-black/45" style={{ height: `${keep.top}%` }} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${insets.bottom}%` }} />
            <div aria-hidden="true" className="pointer-events-none absolute left-0 bg-black/45" style={{ top: `${keep.top}%`, height: `${keep.height}%`, width: `${keep.left}%` }} />
            <div aria-hidden="true" className="pointer-events-none absolute right-0 bg-black/45" style={{ top: `${keep.top}%`, height: `${keep.height}%`, width: `${insets.right}%` }} />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_1px_white]"
              style={{ left: `${keep.left}%`, top: `${keep.top}%`, width: `${keep.width}%`, height: `${keep.height}%` }}
            />
          </div>
        </div>
      )}
      <p className="text-sm text-muted">在照片上拖曳框出題目，或用下面的滑桿調整。</p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {SIDES.map(({ key, label }) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`} className="flex items-center justify-between text-sm font-medium">
              <span>
                {label} {insets[key]}%
              </span>
            </label>
            <input
              id={`${id}-${key}`}
              type="range"
              min={0}
              max={90}
              step={1}
              value={insets[key]}
              disabled={busy}
              aria-valuetext={`${insets[key]}%`}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                setInsets((c) => clampInsets({ ...c, [key]: value }, key));
              }}
              className="min-h-11 w-full accent-[var(--primary)]"
            />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={busy || broken} onClick={() => void confirm()}>
          {busy ? '處理中…' : '確定框選'}
        </button>
        <button type="button" className={secondaryBtn} disabled={busy || isFullPhoto(insets)} onClick={() => setInsets(FULL_PHOTO)}>
          使用整張
        </button>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onCancel}>
          不用這張
        </button>
      </div>
    </section>
  );
}
