/**
 * 授權的名稱（licenseLabel：CC BY-SA 4.0，不是內部代碼 CC-BY-SA-4.0），認得的授權連到授權條款頁（licenseUrl）。
 * CC BY 的標示要附授權條款連結；選文的改作出處（AiSourceNote）與圖表的資料來源（ChartFigure）共用。
 */
import { ExternalLink } from 'lucide-react';
import { licenseLabel, licenseUrl } from '../chart';

export function LicenseLink({ license }: { license: string }) {
  const label = licenseLabel(license);
  const url = licenseUrl(license);
  if (!url) return <>{label}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer license" className="inline-flex items-center gap-0.5 text-primary underline" data-testid="license-link">
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">（授權條款，另開新分頁）</span>
    </a>
  );
}
