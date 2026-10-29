/**
 * 國文在科目登記表裡的解析元件（docs/design/assistant-subjects.md §8.1）：依 kind 分到 ZhChoiceView、ZhShortView、ZhWritingView。
 * 「可能是多選題」的「改成多選重看」在這裡送 PATCH（0 點；§5.3），回來的案例交給案例頁的輪詢器。
 */
import type { ZhChoiceMode } from '@gsat/shared';
import { useState } from 'react';
import { ErrorMessage } from '../../../writing/components/ui';
import type { ErrorView } from '../../../writing/lib/errors';
import { patchAssistCase } from '../../lib/assistApi';
import { useAssistErrorView } from '../../lib/pollers';
import type { SubjectAnalysisProps } from '../types';
import { ZhChoiceView } from './ZhChoiceView';
import { ZhShortView } from './ZhShortView';
import { ZhWritingView } from './ZhWritingView';
import type { ZhViewCommonProps } from './ZhCommon';

export function ZhAnalysis({ detail, analysis, sourceNote, locatable, onLocate, onUpdated }: SubjectAnalysisProps) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const errorView = useAssistErrorView();
  const common: ZhViewCommonProps = { hintFirst: detail.hint_first, sourceNote, locatable, onLocate };

  if (analysis.kind === 'zh_choice') {
    const modes: Record<string, ZhChoiceMode | undefined> = Object.fromEntries((detail.question?.targets ?? []).map((t) => [t.label, t.choice_mode]));
    const switchToMulti = async () => {
      setSwitching(true);
      setError(null);
      try {
        onUpdated(await patchAssistCase(detail.id, { choice_mode: 'multi' }));
      } catch (err) {
        setError(await errorView(err));
      } finally {
        setSwitching(false);
      }
    };
    return (
      <div className="space-y-3">
        <ZhChoiceView analysis={analysis} modes={modes} common={common} onSwitchToMulti={() => void switchToMulti()} switching={switching} />
        {error && <ErrorMessage view={error} />}
      </div>
    );
  }
  if (analysis.kind === 'zh_short') return <ZhShortView analysis={analysis} common={common} />;
  if (analysis.kind === 'zh_writing') return <ZhWritingView analysis={analysis} common={common} />;
  return null;
}
