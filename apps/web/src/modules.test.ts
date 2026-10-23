/**
 * 頁面清單的完成狀態：功能已經上線的模組要是 'ready'，頁首與首頁卡片才不會再掛「開發中」。
 * 目前每一頁都上線了（「READY 涵蓋目前所有頁面」確認沒有 dev）；之後新增還沒完成的模組（status: 'dev'）時，
 * 不要把它加進 READY，並把那個測試改成只排除那一頁。
 */
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, PAGES, getPage, isDevPage, isPageEnabled, navPages, type PagePath } from './modules';

const READY: readonly PagePath[] = [
  '/',
  '/words',
  '/practice',
  '/vocabulary',
  '/cloze',
  '/word-bank',
  '/structure',
  '/reading',
  '/mixed',
  '/translation',
  '/composition',
  '/writing',
  '/exams',
  '/mock',
  '/assistant',
  '/settings',
  '/about',
];

describe('modules.ts 的完成狀態', () => {
  it.each(READY)('%s 已上線（ready）', (path) => {
    expect(getPage(path).status).toBe('ready');
  });

  it('每一頁的狀態都是 dev 或 ready', () => {
    for (const page of PAGES) expect(['dev', 'ready']).toContain(page.status);
  });

  it('READY 涵蓋目前所有頁面：沒有頁面還掛著「開發中」', () => {
    expect(PAGES.filter((p) => isDevPage(p)).map((p) => p.path)).toEqual([]);
    expect([...READY].sort()).toEqual(PAGES.map((p) => p.path).sort());
  });

  it('首頁卡片用標題比對連結：每個學習模組的說明都不含其他學習模組的標題', () => {
    const modules = PAGES.filter((p) => p.isStudyModule);
    for (const page of modules) {
      for (const other of modules) {
        if (other.path !== page.path) expect(page.summary, `${page.path} 的說明含「${other.title}」`).not.toContain(other.title);
      }
    }
  });
});

describe('由功能開關控制的頁面（學習助手，docs/design/learning-assistant.md §5.1）', () => {
  it('/assistant 是「實戰」群組的學習模組，排在模擬考之後，由 assistant 開關控制', () => {
    const page = getPage('/assistant');
    expect(page).toMatchObject({ group: 'exam', icon: 'assistant', isStudyModule: true, feature: 'assistant', status: 'ready' });
    const exam = PAGES.filter((p) => p.group === 'exam').map((p) => p.path);
    expect(exam.indexOf('/assistant')).toBe(exam.indexOf('/mock') + 1);
    expect(NAV_GROUPS.find((g) => g.id === 'exam')?.label).toBe('實戰');
    expect(page.summary).not.toMatch(/大考中心|CEEC/);
  });

  it('開關關著時導覽與首頁不列它，其他頁面不變；打開時才出現', () => {
    const off = navPages({ assistant: false }).map((p) => p.path);
    const on = navPages({ assistant: true }).map((p) => p.path);
    expect(off).not.toContain('/assistant');
    expect(on).toContain('/assistant');
    expect(off).toEqual(PAGES.filter((p) => p.path !== '/assistant').map((p) => p.path));
    expect(on).toEqual(PAGES.map((p) => p.path));
    expect(isPageEnabled(getPage('/mock'), { assistant: false })).toBe(true);
  });
});
