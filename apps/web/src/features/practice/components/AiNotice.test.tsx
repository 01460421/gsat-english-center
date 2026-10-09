/**
 * AI 內容的標示（AiSourceNote）：原創、依事實單撰寫（參考資料；資料集來源另標授權）、CC BY 改作（出處說明＋授權名稱＋授權條款連結）。
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PracticeGroupFile } from '../../../data/bank';
import { AI_PASSAGE_NOTICE, AI_REFERENCES_NOTICE } from '../labels';
import { group } from '../testFixtures';
import { AiSourceNote } from './AiNotice';

const withProvenance = (key: string, provenance: Partial<PracticeGroupFile['provenance']>): PracticeGroupFile => {
  const file = group(key);
  return { ...file, provenance: { ...file.provenance, ...provenance } };
};

describe('AiSourceNote', () => {
  it('CC BY 改作（adapted）：出處說明後面是授權名稱（CC BY-SA 4.0，不是內部代碼），連到授權條款頁；原文連結標「改寫自」', () => {
    const file = withProvenance('ai.rd.0c1d2e@1', {
      license: 'CC-BY-SA-4.0',
      derivation: 'adapted',
      attribution_text: 'Adapted from “Food waste” by Wikipedia contributors',
      sources: [{ role: 'adapted_text', url: 'https://en.wikipedia.org/wiki/Food_waste' }],
      references: [],
    });
    render(<AiSourceNote file={file} />);
    const attribution = screen.getByTestId('attribution');
    expect(attribution).toHaveTextContent('Adapted from “Food waste” by Wikipedia contributors（授權：CC BY-SA 4.0');
    expect(attribution).not.toHaveTextContent('CC-BY-SA-4.0');
    const license = within(attribution).getByRole('link', { name: /CC BY-SA 4\.0/ });
    expect(license).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    expect(license).toHaveAttribute('target', '_blank');
    expect(license).toHaveAccessibleName(/授權條款，另開新分頁/);
    expect(screen.getByRole('link', { name: /改寫自/ })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Food_waste');
  });

  it('CC BY 4.0 的改作也一樣；不認得的授權只顯示文字、不加連結', () => {
    const { unmount } = render(<AiSourceNote file={withProvenance('ai.rd.0c1d2e@1', { license: 'CC-BY-4.0', derivation: 'adapted', attribution_text: 'Adapted from X', references: [] })} />);
    expect(within(screen.getByTestId('attribution')).getByRole('link', { name: /CC BY 4\.0/ })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    unmount();
    render(<AiSourceNote file={withProvenance('ai.rd.0c1d2e@1', { license: 'Some-License' as never, derivation: 'adapted', attribution_text: 'Adapted from Y', references: [] })} />);
    expect(screen.getByTestId('attribution')).toHaveTextContent('Adapted from Y（授權：Some-License）');
    expect(within(screen.getByTestId('attribution')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('AI 原創：沒有出處說明與授權；依事實單撰寫的列參考資料', () => {
    const { unmount } = render(<AiSourceNote file={withProvenance('ai.wb.0a1b2c@1', { references: [] })} />);
    expect(screen.getByText(AI_PASSAGE_NOTICE)).toBeInTheDocument();
    expect(screen.queryByTestId('attribution')).not.toBeInTheDocument();
    unmount();
    render(<AiSourceNote file={group('ai.rd.0c1d2e@1')} />);
    expect(screen.getByText(AI_REFERENCES_NOTICE)).toBeInTheDocument();
    expect(screen.queryByTestId('attribution')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('references')).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('參考資料：資料集來源（表格、圖表用了它的數值）在來源連結後面標授權名稱與授權條款連結；只取事實的來源不標', () => {
    render(
      <AiSourceNote
        file={withProvenance('ai.rd.0c1d2e@1', {
          references: [
            { publisher: 'Our World in Data', title: 'Carbon footprint of travel per kilometer', url: 'https://ourworldindata.org/grapher/carbon-footprint-travel-mode', license: 'CC-BY-4.0' },
            { publisher: 'CNN', title: 'Night trains', url: 'https://www.cnn.com/travel/night-trains' },
          ],
        })}
      />,
    );
    const items = within(screen.getByTestId('references')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [dataset, factOnly] = items as [HTMLElement, HTMLElement];
    expect(dataset).toHaveTextContent(/^Our World in Data: Carbon footprint of travel per kilometer（另開新分頁）（授權：CC BY 4\.0/);
    expect(dataset).not.toHaveTextContent('CC-BY-4.0');
    const license = within(dataset).getByRole('link', { name: /CC BY 4\.0/ });
    expect(license).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    expect(license).toHaveAccessibleName(/授權條款，另開新分頁/);
    // 授權連結在來源連結外面（連結不能包連結）。
    expect(within(dataset).getByRole('link', { name: /^Our World in Data/ })).not.toContainElement(license);
    expect(within(factOnly).getAllByRole('link')).toHaveLength(1);
    expect(factOnly).not.toHaveTextContent('授權');
  });
});
