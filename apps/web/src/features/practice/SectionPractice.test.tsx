/**
 * 六個題型說明頁（詞彙題、綜合測驗、文意選填、篇章結構、閱讀測驗、混合題）的「現在就能練習」：三種難度的練習入口、
 * 歷屆試題入口，以及只列出該題型真的有的功能（排除法表只有選項庫題型、錯題本只有詞彙題、圖表與誘答類型只有閱讀、
 * 自動判分只有混合題）。頁面上不再有「開發中」與「規劃中的功能」。
 */
import { render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { PracticeSectionType } from '../../data/bank';
import ClozePage from '../../pages/ClozePage';
import MixedPage from '../../pages/MixedPage';
import ReadingPage from '../../pages/ReadingPage';
import StructurePage from '../../pages/StructurePage';
import VocabularyPage from '../../pages/VocabularyPage';
import WordBankPage from '../../pages/WordBankPage';
import { AI_GROUP_LABEL, TIER_AUDIENCE, TIER_LABELS, TIERS, practicePath } from './labels';

const CASES: [PracticeSectionType, ComponentType, string][] = [
  ['vocabulary', VocabularyPage, '詞彙題'],
  ['cloze', ClozePage, '綜合測驗'],
  ['word_bank', WordBankPage, '文意選填'],
  ['structure', StructurePage, '篇章結構'],
  ['reading', ReadingPage, '閱讀測驗'],
  ['mixed', MixedPage, '混合題'],
];

function renderPage(Page: ComponentType) {
  return render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
}

describe.each(CASES)('%s 說明頁', (section, Page, title) => {
  it('沒有「開發中」標記與橫幅，也沒有「規劃中的功能」；保留「學測怎麼考」', () => {
    renderPage(Page);
    const h1 = screen.getByRole('heading', { level: 1, name: title });
    expect(within(h1.parentElement as HTMLElement).queryByText('開發中')).not.toBeInTheDocument();
    expect(screen.queryByText('開發中')).not.toBeInTheDocument();
    expect(screen.queryByText(/這個模組還在開發中/)).not.toBeInTheDocument();
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
    expect(screen.queryByText(/即將/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '學測怎麼考' })).toBeInTheDocument();
  });

  it('現在就能練習：三種難度各一個入口（附適合誰）、歷屆試題入口', () => {
    renderPage(Page);
    const region = screen.getByRole('region', { name: '現在就能練習' });
    const tierLinks = TIERS.map((tier) => {
      const link = within(region).getByRole('link', { name: new RegExp(`^${TIER_LABELS[tier]}`) });
      expect(link).toHaveAttribute('href', practicePath(section, tier));
      expect(link).toHaveTextContent(TIER_AUDIENCE[tier].who);
      return link;
    });
    expect(new Set(tierLinks.map((a) => a.getAttribute('href'))).size).toBe(3);
    expect(within(region).getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '/exams');
  });

  it('只列出這個題型真的有的功能', () => {
    renderPage(Page);
    const offers = screen.getByRole('list', { name: '題庫練習有什麼' });
    expect(offers).toHaveTextContent(AI_GROUP_LABEL);
    expect(offers).toHaveTextContent('逐層打開提示');
    expect(offers).toHaveTextContent('四段式解析');
    expect(offers).toHaveTextContent('全文中譯');

    const bank = section === 'word_bank' || section === 'structure';
    if (bank) expect(offers).toHaveTextContent('排除法表');
    else expect(offers).not.toHaveTextContent('排除法表');

    const mistakesLink = within(offers).queryByRole('link', { name: '單字錯題本' });
    if (section === 'vocabulary') {
      expect(mistakesLink).toHaveAttribute('href', '/words?tab=mistakes');
      expect(offers).not.toHaveTextContent('選文');
    } else {
      expect(mistakesLink).not.toBeInTheDocument();
    }

    // 參考資料：閱讀每組都有，混合題只有參考事實資料寫成的才有，其他題型沒有。
    if (section === 'reading' || section === 'mixed') expect(offers).toHaveTextContent('參考資料');
    else expect(offers).not.toHaveTextContent('參考資料');
    if (section === 'mixed') expect(offers).toHaveTextContent('部分題組參考事實資料撰寫');

    // 圖表、表格、誘答類型只有閱讀。
    if (section === 'reading') {
      expect(offers).toHaveTextContent('長條圖、折線圖');
      expect(offers).toHaveTextContent('表格');
      expect(offers).toHaveTextContent('多文本');
      expect(offers).toHaveTextContent('誘答類型');
      // 只有圖上加粗框；表格與資料表是那一列加底色、標「解析引用」。
      expect(offers).toHaveTextContent('圖表裡引用到的資料點會加粗框');
      expect(offers).toHaveTextContent('加底色並標「解析引用」');
    } else {
      expect(offers).not.toHaveTextContent('長條圖');
      expect(offers).not.toHaveTextContent('誘答類型');
    }

    // 混合題：填充、多選、簡答，交卷後依規則自動判分（不是 AI 批改）。
    if (section === 'mixed') {
      expect(offers).toHaveTextContent('填充（摘要填空）、多選與簡答');
      expect(offers).toHaveTextContent('(n − 2k)/n');
      expect(offers).toHaveTextContent('不是 AI 批改');
      expect(offers).toHaveTextContent('部分分數');
    } else {
      expect(offers).not.toHaveTextContent('自動計分');
    }
  });
});
