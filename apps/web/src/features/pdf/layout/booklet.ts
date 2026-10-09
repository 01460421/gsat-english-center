/**
 * 題本本體（設計文件 §5.3–§5.9）：部分標題 → 部分說明框 → 大題標題 → 說明框 → 各題組。
 * 第貳部分起每個部分從新的一頁開始（題本如此）；標題、說明框、題組標示不落在頁底由 blocks.ts 處理。
 */
import type { Exam, ExamSection } from '../../../data/exams';
import type { Block } from './blocks';
import { groupBlocks } from './groups';
import { headingBlock, instructionsBlock } from './nodes';
import { bookletParts } from './parts';

function sectionBlocks(section: ExamSection, breakBefore: boolean): Block[] {
  const blocks: Block[] = [headingBlock(section.title, { breakBefore, marginTop: breakBefore ? 0 : 6 })];
  if (section.instructions.trim() !== '') blocks.push(instructionsBlock(section.instructions));
  for (const group of section.groups) blocks.push(...groupBlocks(section, group));
  return blocks;
}

/** 整份題本的區塊串（交給 flowBlocks 排成內容）。 */
export function bookletBlocks(exam: Pick<Exam, 'parts' | 'sections'>): Block[] {
  const blocks: Block[] = [];
  bookletParts(exam).forEach((part, i) => {
    const newPage = i > 0;
    let pendingBreak = newPage;
    if (part.title !== null) {
      blocks.push(headingBlock(part.title, { breakBefore: newPage, marginTop: 0 }));
      pendingBreak = false;
    }
    if (part.instructions && part.instructions.trim() !== '') {
      const box = instructionsBlock(part.instructions);
      blocks.push(pendingBreak ? { ...box, breakBefore: true } : box);
      pendingBreak = false;
    }
    part.sections.forEach((section, j) => {
      blocks.push(...sectionBlocks(section, pendingBreak && j === 0));
    });
  });
  return blocks;
}
