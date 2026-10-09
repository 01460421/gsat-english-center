/**
 * 圖表元件（純 SVG）：四種圖、空資料、負數、單一數列；圖例、軸名與單位、資料來源、可展開的資料表、
 * role="img"＋aria-label、點選看數值、交卷後標出證據引用的資料點。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ChartSpec, PracticeFigure } from '../../../data/bank';
import { textWidth, wrapText } from '../chart';
import { group } from '../testFixtures';
import { ChartView, categoryBandWidth } from './Chart';
import { ChartFigure, TableFigure, renderPracticeFigure } from './PracticeFigure';

const SOURCE = { publisher: 'Our World in Data', title: 'Food waste', url: 'https://ourworldindata.org/food-waste', license: 'CC-BY-4.0', accessed: '2026-10-09' };

function spec(overrides: Partial<ChartSpec>): ChartSpec {
  return {
    type: 'bar',
    title: 'Food wasted per person',
    x: { label: 'Region', unit: null },
    y: { label: 'Food wasted', unit: 'kg' },
    categories: ['Africa', 'Asia', 'Europe'],
    series: [{ name: 'Households', values: [80, 75, 70] }],
    note: null,
    source: SOURCE,
    ...overrides,
  };
}

const figureOf = (chart: ChartSpec, description = '測試用的圖表描述。'): PracticeFigure => ({
  kind: 'chart',
  label: 'Chart 1',
  caption: chart.title,
  description,
  rows: null,
  question_no: null,
  chart,
});

const lineFigure = (): PracticeFigure => {
  const figure = group('ai.rd.0c1d2e@1').group.figures[0];
  if (!figure) throw new Error('範例缺少圖表');
  return figure;
};

describe('四種圖', () => {
  it('折線圖（範例題組）：每個數列一條線、每個點一個標記，圖例三項，軸名與單位', () => {
    const figure = lineFigure();
    const { container } = render(<ChartFigure figure={figure} chart={figure.chart as ChartSpec} evidence={[]} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('data-chart-type', 'line');
    expect(svg.getAttribute('aria-label')).toMatch(/^折線圖：Children who die before age 5, 1990–2020。折線圖。橫軸是年份/);
    // 3 條線（path 的 fill 是 none）。
    const lines = Array.from(container.querySelectorAll('svg[role="img"] path')).filter((p) => (p as SVGPathElement).style.fill === 'none');
    expect(lines).toHaveLength(3);
    expect(within(screen.getByRole('list', { name: '圖例' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'World',
      'South Asia',
      'Sub-Saharan Africa',
    ]);
    expect(screen.getByText(/^縱軸：/)).toHaveTextContent('縱軸：Deaths before age 5 (per 1,000 live births)');
    expect(screen.getByText(/^橫軸：/)).toHaveTextContent('橫軸：Year');
    // 刻度從 0 到 200。
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toEqual(expect.arrayContaining(['0', '50', '200', '1990', '2020']));
    // 最後一個點的數值：39.2 與 32.4 靠太近，只標其中一個；75.9 一定標。
    expect(svg.textContent).toContain('75.9');
    expect(screen.getByText(/附註：/)).toHaveTextContent('Each line shows the rate for the region as a whole.');
  });

  it('長條圖：一個數列每個類別一根，數值標在長條頂端', () => {
    render(<ChartView chart={spec({})} label="長條圖" />);
    const svg = screen.getByRole('img', { name: '長條圖' });
    expect(svg).toHaveAttribute('data-chart-type', 'bar');
    const bars = Array.from(svg.querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill.startsWith('var(--chart'));
    expect(bars).toHaveLength(3);
    expect(svg.textContent).toContain('80');
    expect(svg.textContent).toContain('70');
  });

  it('分組長條：每個類別、每個數列一根，顏色依數列順序', () => {
    const chart = spec({ series: [{ name: 'Homes', values: [80, 75, 70] }, { name: 'Shops', values: [10, 12, 14] }] });
    render(<ChartView chart={chart} label="分組" />);
    const bars = Array.from(screen.getByRole('img').querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill.startsWith('var(--chart'));
    expect(bars).toHaveLength(6);
    expect(bars.map((b) => (b as SVGPathElement).style.fill)).toEqual(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-1)', 'var(--chart-2)', 'var(--chart-1)', 'var(--chart-2)']);
  });

  it('堆疊長條：每一段一個色塊，頂端標總和', () => {
    const chart = spec({ type: 'stacked_bar', series: [{ name: 'Homes', values: [60, 50, 40] }, { name: 'Shops', values: [20, 25, 30] }] });
    render(<ChartView chart={chart} label="堆疊" />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('data-chart-type', 'stacked_bar');
    expect(Array.from(svg.querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill.startsWith('var(--chart'))).toHaveLength(6);
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toEqual(expect.arrayContaining(['80', '75', '70']));
  });

  it('圓餅圖：一個類別一片，扇形裡標百分比，圖例附數值', () => {
    const chart = spec({ type: 'pie', y: { label: 'Share of food waste', unit: '%' }, categories: ['Households', 'Food service', 'Retail'], series: [{ name: 'Share', values: [60, 28, 12] }] });
    render(<ChartView chart={chart} label="圓餅" />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('data-chart-type', 'pie');
    expect(svg.querySelectorAll('path')).toHaveLength(3);
    expect(svg.textContent).toContain('60%');
    expect(screen.getByRole('list', { name: '圖例' })).toHaveTextContent('Households：60%');
  });

  describe('圓餅圖的單位是 %：扇形標原始數值，和圖例、讀數、資料表一致（不重新算占比）', () => {
    const sliceLabels = (svg: Element) => Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    it('數值有小數（12.5、37.5、50）', async () => {
      const user = userEvent.setup();
      const chart = spec({ type: 'pie', y: { label: 'Share', unit: '%' }, categories: ['Paper', 'Metal', 'Food waste'], series: [{ name: 'Share', values: [12.5, 37.5, 50] }] });
      render(<ChartFigure figure={figureOf(chart)} chart={chart} evidence={[]} />);
      const svg = screen.getByRole('img');
      expect(sliceLabels(svg)).toEqual(['12.5%', '37.5%', '50%']);
      expect(screen.getByRole('list', { name: '圖例' })).toHaveTextContent('Paper：12.5%Metal：37.5%Food waste：50%');
      await user.click(svg.querySelectorAll('path')[0] as Element);
      expect(screen.getByTestId('chart-readout')).toHaveTextContent('Paper：12.5%');
      expect(screen.getByTestId('chart-readout')).not.toHaveTextContent('占');
      await user.click(screen.getByText('資料表'));
      expect(screen.getByRole('row', { name: /^Paper/ })).toHaveTextContent('Paper12.5');
      expect(screen.queryByRole('columnheader', { name: '占比' })).not.toBeInTheDocument();
    });

    it('加總不是 100（30＋12.5＋40＝82.5）：仍標 30%、12.5%、40%，不是重新算的 36%、15%、48%', () => {
      const chart = spec({ type: 'pie', y: { label: 'Share', unit: '%' }, categories: ['Paper', 'Metal', 'Food waste'], series: [{ name: 'Share', values: [30, 12.5, 40] }] });
      render(<ChartView chart={chart} label="加總不是 100" />);
      expect(sliceLabels(screen.getByRole('img'))).toEqual(['30%', '12.5%', '40%']);
    });

    it('單位不是 %：扇形標重新算的占比', () => {
      const chart = spec({ type: 'pie', y: { label: 'Food wasted', unit: 'Mt' }, categories: ['Homes', 'Food service', 'Retail'], series: [{ name: 'Waste', values: [631, 290, 131] }] });
      render(<ChartView chart={chart} label="占比" />);
      expect(sliceLabels(screen.getByRole('img'))).toEqual(['60%', '28%', '12%']);
    });
  });
});

describe('邊界情況', () => {
  it('空資料（沒有類別或數列）：不畫空的座標軸，顯示說明', () => {
    render(<ChartView chart={spec({ categories: [], series: [] })} label="空" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('這張圖沒有資料可以畫。')).toBeInTheDocument();
  });

  it('圓餅圖全部是 0：也當成沒有資料', () => {
    render(<ChartView chart={spec({ type: 'pie', series: [{ name: 'x', values: [0, 0, 0] }] })} label="空圓餅" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('負數：長條往基線下方長，刻度有負值', () => {
    const chart = spec({ title: 'Change', y: { label: 'Change', unit: '%' }, series: [{ name: 'Change', values: [12, -8, 4] }] });
    render(<ChartView chart={chart} label="負數" />);
    const svg = screen.getByRole('img');
    const ticks = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent ?? '');
    expect(ticks.some((t) => t.startsWith('-'))).toBe(true);
    expect(svg.textContent).toContain('-8');
    // 負值那一根的資料端在基線下面：path 從基線往下（V 的值比起點大）。
    const bars = Array.from(svg.querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill.startsWith('var(--chart'));
    const parse = (d: string) => d.match(/-?[\d.]+/g)?.map(Number) ?? [];
    const [, baseY = 0, endY = 0] = parse(bars[1]?.getAttribute('d') ?? '');
    expect(endY).toBeGreaterThan(baseY);
  });

  it('負數的折線與堆疊長條也畫得出來', () => {
    render(<ChartView chart={spec({ type: 'line', series: [{ name: 'A', values: [-5, 3, -1] }, { name: 'B', values: [2, -4, 6] }] })} label="負數折線" />);
    expect(screen.getByRole('img', { name: '負數折線' })).toHaveAttribute('data-chart-type', 'line');
    render(<ChartView chart={spec({ type: 'stacked_bar', series: [{ name: 'A', values: [-5, 3, -1] }, { name: 'B', values: [2, -4, 6] }] })} label="負數堆疊" />);
    const svg = screen.getByRole('img', { name: '負數堆疊' });
    expect(Array.from(svg.querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill.startsWith('var(--chart'))).toHaveLength(6);
  });

  it('圓餅圖有負值：負值那片不畫，說明請看資料表', () => {
    render(<ChartView chart={spec({ type: 'pie', series: [{ name: 'x', values: [5, -2, 3] }] })} label="負圓餅" />);
    expect(screen.getByRole('img').querySelectorAll('path')).toHaveLength(2);
    expect(screen.getByText(/有 1 個類別的數值是 0 或負數/)).toBeInTheDocument();
  });

  it('單一數列的折線：一條線，圖例一項', () => {
    render(<ChartView chart={spec({ type: 'line', categories: ['2019', '2020', '2021'], series: [{ name: 'World', values: [1, 2, 3] }] })} label="單一" />);
    const svg = screen.getByRole('img');
    expect(Array.from(svg.querySelectorAll('path')).filter((p) => (p as SVGPathElement).style.fill === 'none')).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: '圖例' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('類別很多、容器很窄：圖有最小寬度，外框可以左右捲動（頁面不被撐寬）', () => {
    const categories = Array.from({ length: 30 }, (_, i) => `C${i + 1}`);
    render(<ChartView chart={spec({ categories, series: [{ name: 'A', values: categories.map((_, i) => i) }, { name: 'B', values: categories.map((_, i) => 30 - i) }] })} label="很寬" />);
    const svg = screen.getByRole('img');
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(640);
    const scroller = screen.getByRole('group', { name: '圖表（可以左右捲動）' });
    expect(scroller).toHaveClass('overflow-x-auto');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('圖比畫面寬，可以左右滑動。')).toBeInTheDocument();
  });

  describe('類別名稱比每格寬：圖變寬（可以左右捲動），橫軸的標籤不互相重疊、不超出 SVG', () => {
    /** 橫軸的類別標籤（有 tspan 的 text）：中心、估計的寬度（和排版用的 textWidth 同一套估法）、每一行。 */
    const xLabels = (svg: Element) =>
      Array.from(svg.querySelectorAll('text'))
        .filter((t) => t.querySelector('tspan'))
        .map((t) => {
          const lines = Array.from(t.querySelectorAll('tspan')).map((s) => s.textContent ?? '');
          return { x: Number(t.getAttribute('x')), w: Math.max(...lines.map((l) => textWidth(l, 12))), lines };
        });
    const expectNoOverlap = (svg: Element, categories: string[]) => {
      const width = Number(svg.getAttribute('width'));
      const labels = xLabels(svg);
      // 每個類別都完整標出來（沒有被截成「…」），每一行都不超過 3 行。
      expect(labels.map((l) => l.lines.join(' '))).toEqual(categories);
      for (const l of labels) expect(l.lines.length).toBeLessThanOrEqual(3);
      labels.forEach((l, i) => {
        expect(l.x - l.w / 2, `${l.lines.join(' ')} 的左緣`).toBeGreaterThanOrEqual(0);
        expect(l.x + l.w / 2, `${l.lines.join(' ')} 的右緣`).toBeLessThanOrEqual(width);
        const next = labels[i + 1];
        if (next) expect(l.x + l.w / 2 + 4, `${l.lines.join(' ')} 和 ${next.lines.join(' ')}`).toBeLessThanOrEqual(next.x - next.w / 2);
      });
    };

    it('5 個國家名、2 個數列，手機寬度（容器 300px；Bangladesh、Philippines 比每格寬）', () => {
      // happy-dom 沒有排版，clientWidth 是 0（圖改用 640）；這裡假裝容器是手機上的 300px。
      const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
      onTestFinished(() => spy.mockRestore());
      const categories = ['Bangladesh', 'Philippines', 'Indonesia', 'Vietnam', 'Thailand'];
      render(<ChartView chart={spec({ categories, series: [{ name: '2000', values: [1, 2, 3, 4, 5] }, { name: '2020', values: [5, 4, 3, 2, 1] }] })} label="國家" />);
      expectNoOverlap(screen.getByRole('img'), categories);
    });

    it('12 個長區域名（Latin America and the Caribbean、Internationalization）：每個都完整、不重疊，最右邊的不被裁掉', () => {
      const categories = [
        'Sub-Saharan Africa', 'Latin America and the Caribbean', 'East Asia and Pacific', 'South Asia', 'Europe and Central Asia',
        'Middle East and North Africa', 'North America', 'Oceania', 'Western Europe', 'Eastern Europe', 'Central America', 'Internationalization',
      ];
      for (const type of ['bar', 'line', 'stacked_bar'] as const) {
        const { unmount } = render(
          <ChartView chart={spec({ type, categories, series: [{ name: 'A', values: categories.map((_, i) => i + 1) }, { name: 'B', values: categories.map((_, i) => 12 - i) }] })} label={type} />,
        );
        const svg = screen.getByRole('img');
        expectNoOverlap(svg, categories);
        expect(Number(svg.getAttribute('width'))).toBeGreaterThan(640);
        expect(screen.getByText('圖比畫面寬，可以左右滑動。')).toBeInTheDocument();
        unmount();
      }
    });

    it('categoryBandWidth：最長的單字放得下、換行不超過 3 行', () => {
      expect(categoryBandWidth('2020')).toBeLessThanOrEqual(40);
      expect(categoryBandWidth('Bangladesh')).toBeGreaterThanOrEqual(textWidth('Bangladesh', 12) + 8);
      const w = categoryBandWidth('Latin America and the Caribbean');
      expect(wrapText('Latin America and the Caribbean', w - 8, 12, Number.POSITIVE_INFINITY).length).toBeLessThanOrEqual(3);
    });
  });
});

describe('互動、資料表與資料來源', () => {
  it('點長條看數值（讀數在圖下方）', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChartView chart={spec({})} label="長條" />);
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('點圖上的長條可以看數值');
    const hits = Array.from(container.querySelectorAll('rect')).filter((r) => r.style.fill === 'transparent');
    expect(hits).toHaveLength(3);
    await user.click(hits[1] as Element);
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Asia：75 kg');
  });

  it('還沒點選時的說明依圖的類型（長條、堆疊的每一段、資料點、扇形）', () => {
    const hint = (type: ChartSpec['type']) => {
      const series = type === 'pie' ? [{ name: 'A', values: [1, 2, 3] }] : [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [3, 2, 1] }];
      const { unmount } = render(<ChartView chart={spec({ type, series })} label={type} />);
      const text = screen.getByTestId('chart-readout').textContent;
      unmount();
      return text;
    };
    expect(hint('bar')).toContain('點圖上的長條');
    expect(hint('stacked_bar')).toContain('長條裡的每一段');
    expect(hint('line')).toContain('資料點');
    expect(hint('pie')).toContain('扇形');
  });

  it('資料來源：publisher 連結與授權；資料表是 <table>，展開就看得到每個數字', async () => {
    const user = userEvent.setup();
    const figure = lineFigure();
    render(<ChartFigure figure={figure} chart={figure.chart as ChartSpec} evidence={[]} />);
    const source = screen.getByTestId('chart-source');
    expect(source).toHaveTextContent('資料來源：World Bank（另開新分頁）（CC BY 4.0（授權條款，另開新分頁））');
    expect(within(source).getByRole('link', { name: /World Bank/ })).toHaveAttribute('href', 'https://data.worldbank.org/indicator/SH.DYN.MORT');
    // 授權寫成名稱、連到授權條款頁（CC BY 的標示要附授權條款連結）。
    expect(within(source).getByRole('link', { name: /CC BY 4\.0/ })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    await user.click(screen.getByText('資料表'));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Year',
      'World (per 1,000 live births)',
      'South Asia (per 1,000 live births)',
      'Sub-Saharan Africa (per 1,000 live births)',
    ]);
    expect(within(table).getByRole('row', { name: /^2020/ })).toHaveTextContent('2020' + '39.2' + '32.4' + '75.9');
  });

  it('交卷後：證據引用的資料點在圖上加粗框、資料表那一列加底色', () => {
    const figure = lineFigure();
    const { container } = render(
      <ChartFigure figure={figure} chart={figure.chart as ChartSpec} evidence={['2020, Sub-Saharan Africa: 75.9 per 1,000 live births', 'Some sentence.']} />,
    );
    const rings = Array.from(container.querySelectorAll('circle')).filter((c) => c.style.stroke === 'var(--fg)');
    expect(rings).toHaveLength(1);
    expect(screen.getByText(/粗框標出的是解析引用的數據/)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /^2020/ });
    expect(row).toHaveTextContent('（解析引用）');
  });

  it('圓餅圖的資料表多一欄占比（單位不是 % 時）', () => {
    const chart = spec({ type: 'pie', y: { label: 'Food wasted', unit: 'Mt' }, categories: ['Homes', 'Food service', 'Retail'], series: [{ name: 'Waste', values: [631, 290, 131] }] });
    render(<ChartFigure figure={figureOf(chart)} chart={chart} evidence={[]} />);
    expect(screen.getByRole('columnheader', { name: '占比' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Homes/ })).toHaveTextContent('60%');
  });
});

describe('表格（kind: table）與其他圖', () => {
  const rows = [
    ['Shop', 'Opens', 'Price'],
    ['Café A', '8:00', '$3'],
    ['Café B', '9:00', '$4'],
  ];
  const tableFigure: PracticeFigure = { kind: 'table', label: 'Table 1', caption: 'Two cafés', description: '兩家咖啡店的開店時間與價格。', rows, question_no: null };

  it('桌機是表格、手機是一列一張卡片（兩種寫法都在 DOM，CSS 只顯示一種）；證據引用的列加底色', () => {
    render(<TableFigure figure={tableFigure} rows={rows} evidence={['Café B | 9:00 | $4']} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    const cards = screen.getByRole('list', { name: /每一列一張卡片/ });
    expect(cards).toHaveClass('sm:hidden');
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2);
    expect(within(cards).getAllByRole('listitem')[1]).toHaveTextContent('ShopCafé B（解析引用）Opens9:00Price$4');
    expect(screen.getByRole('row', { name: /^Café B/ })).toHaveTextContent('（解析引用）');
  });

  it('renderPracticeFigure：圖表與表格自己畫，其他交給歷屆試題的 FigureView（回傳 undefined）', () => {
    expect(renderPracticeFigure({ kind: 'picture', caption: null, description: '一張圖' }, [])).toBeUndefined();
    expect(renderPracticeFigure(tableFigure, [])).toBeDefined();
    expect(renderPracticeFigure(lineFigure(), [])).toBeDefined();
  });
});
