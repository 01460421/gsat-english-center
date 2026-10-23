/**
 * 條款版本必須和後端的現行版本一致（apps/api/wrangler.toml 與 src/config.ts）：不一致時歡迎頁會停用同意按鈕，
 * 所有新使用者都卡在首次設定。改版時這個測試提醒三處一起改。另外測 next 參數的過濾。
 */
import { describe, expect, it } from 'vitest';
import configTs from '../../../../api/src/config.ts?raw';
import wranglerToml from '../../../../api/wrangler.toml?raw';
import { AI_TASK_POINTS, ASSIST_LIMITS, PHOTO_MAX_AGE_HOURS, assistAnalyzePoints } from '@gsat/shared';
import {
  AI_CONSENT_VERSION,
  AI_PROCESSING_NOTICE,
  PRIVACY_POLICY,
  PRIVACY_POLICY_VERSION,
  TERMS_OF_SERVICE,
  TERMS_VERSION,
  formatVersionDate,
  type PolicyDoc,
} from './policy';
import { safeNext } from './ui';
import { aiConsentLabel } from './AiApplyPage';

/** 某一段的全文（標題以 heading 開頭）。 */
function sectionText(doc: PolicyDoc, heading: string): string {
  const sec = doc.sections.find((x) => x.heading.startsWith(heading));
  expect(sec, heading).toBeDefined();
  return [...(sec?.paragraphs ?? []), ...(sec?.bullets ?? [])].join('\n');
}

function tomlVar(name: string): string | undefined {
  return new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(wranglerToml)?.[1];
}

function configDefault(name: string): string | undefined {
  return new RegExp(`${name}:\\s*'([^']*)'`).exec(configTs)?.[1];
}

describe('條款版本與後端一致', () => {
  it.each([
    ['PRIVACY_POLICY_VERSION', PRIVACY_POLICY_VERSION],
    ['TERMS_VERSION', TERMS_VERSION],
    ['AI_CONSENT_VERSION', AI_CONSENT_VERSION],
  ])('%s', (name, version) => {
    expect(tomlVar(name)).toBe(version);
    expect(configDefault(name)).toBe(version);
  });

  it('內文物件帶的就是這些版本', () => {
    expect(PRIVACY_POLICY.version).toBe(PRIVACY_POLICY_VERSION);
    expect(TERMS_OF_SERVICE.version).toBe(TERMS_VERSION);
    expect(AI_PROCESSING_NOTICE.version).toBe(AI_CONSENT_VERSION);
    expect(formatVersionDate('2026-10-08')).toBe('2026 年 10 月 8 日');
  });

  it('隱私權說明涵蓋自訂作文題目（docs/design/custom-essay.md §6.10）', () => {
    const text = JSON.stringify(PRIVACY_POLICY.sections);
    expect(text).toContain('自己輸入或貼上的作文題目');
    expect(text).toContain('你自己在作答或自訂題目裡輸入的文字除外');
    expect(text).toContain('請不要在作答、自訂題目、提問或回饋中寫下');
  });

  it('自動遮掉聯絡方式的說法和實際範圍一致：只說「常見格式」，其他寫法請自己刪除（security-4）', async () => {
    const { normalizeCustomPromptText } = await import('@gsat/shared');
    const text = JSON.stringify(PRIVACY_POLICY);
    expect(text).not.toContain('題目裡的 email 與電話會自動遮掉');
    expect(text).toContain('常見格式的 email、手機與市話號碼會自動遮掉');
    expect(text).toContain('其他寫法的聯絡方式請自己刪除');
    // 「常見格式」真的會遮：email、手機、加括號、連字號、空白分隔或不分隔的市話。
    for (const contact of ['amy@example.com', '0912-345-678', '(02)2771-1234', '02-2771-1234', '02 2771 1234', '0227711234']) {
      expect(normalizeCustomPromptText(`聯絡：${contact}`).masked, contact).toBe(1);
    }
  });

  it('隱私權說明涵蓋必要事項：非營利、蒐集項目、Anthropic、照片刪除、匯出與刪除', () => {
    const text = JSON.stringify(PRIVACY_POLICY);
    for (const phrase of ['非營利', '不收費', 'Anthropic', '不含你的姓名、email', '立即刪除', '匯出我的資料', '刪除帳號', '個人資料保護法']) {
      expect(text, phrase).toContain(phrase);
    }
  });
});

describe('學習助手上線的說明改版（docs/design/learning-assistant.md §4.17）', () => {
  it('三份說明同一天升版（2026-10-23），已核准的學生要重新同意 AI 處理說明', () => {
    expect([PRIVACY_POLICY_VERSION, TERMS_VERSION, AI_CONSENT_VERSION]).toEqual(['2026-10-23', '2026-10-23', '2026-10-23']);
    for (const doc of [PRIVACY_POLICY, TERMS_OF_SERVICE, AI_PROCESSING_NOTICE]) {
      expect(doc.changes.length, doc.title).toBeGreaterThan(0);
      expect(doc.changes.join(''), doc.title).toContain('學習助手');
    }
  });

  it('隱私權說明：適用範圍、蒐集項目、保存期限三行（數字和程式的常數一致）、只框題目的提醒', () => {
    expect(sectionText(PRIVACY_POLICY, '一、')).toContain('只存在你自己的瀏覽器裡；你使用學習助手時，你選擇送出的題目、作答與作答紀錄摘要會傳到本站伺服器');
    const collected = sectionText(PRIVACY_POLICY, '二、');
    for (const phrase of [
      '學習助手：題目照片（暫存',
      '題目文字',
      '你的作答與疑問',
      '追問',
      'AI 解析與學習報告',
      '你對學習報告寫的回饋',
      '每週讀書時間、考試與段考日期',
      '提示次數、標記與先看答案的紀錄',
      // 摘要裡也有單字錯題本、複習卡與逐週計畫的勾選（summary.ts 的 vocab、plan_progress）。
      '單字錯題與複習進度',
      '逐週計畫完成情形',
    ]) {
      expect(collected, phrase).toContain(phrase);
    }
    // 三、資料的用途：學習助手是新的處理目的（ROADMAP D6）。
    const purposes = sectionText(PRIVACY_POLICY, '三、');
    expect(purposes).toContain('提供 AI 批改與學習助手，並控管每個人的點數與全站預算。');
    expect(purposes).toContain('提供學習助手：轉錄題目照片、解析你送出的題目、回答追問，並依你送出的作答紀錄摘要、目標與讀書時間產生學習報告與逐週計畫。');
    // 十、瀏覽器儲存：單字紀錄與學習助手的作答紀錄只有使用學習助手時才送出相關的部分（不再說「不會傳到伺服器」）。
    const storage = sectionText(PRIVACY_POLICY, '十、');
    expect(storage).not.toContain('單字學習紀錄存在你的瀏覽器裡，不會傳到伺服器');
    expect(storage).toContain('只有你使用學習助手（問單字、產生學習報告）時，相關的單字與錯誤次數、複習卡統計才會送到伺服器');
    expect(storage).toContain('產生學習報告時，會送出作答紀錄、單字錯題與複習卡、逐週計畫完成情形的摘要');
    expect(PRIVACY_POLICY.changes.join('')).toContain('資料的用途');
    const retention = sectionText(PRIVACY_POLICY, '七、');
    expect(ASSIST_LIMITS.retentionDays).toBe(180);
    expect(ASSIST_LIMITS.reportsKept).toBe(10);
    expect(PHOTO_MAX_AGE_HOURS).toBe(24);
    expect(retention).toContain(`最後一次更新後 ${ASSIST_LIMITS.retentionDays} 天自動刪除`);
    expect(retention).toContain(`學習報告每人只保留最近 ${ASSIST_LIMITS.reportsKept} 版`);
    expect(retention).toContain(`學習助手的題目照片：轉錄後立即刪除，最長 ${PHOTO_MAX_AGE_HOURS} 小時`);
    expect(retention).toContain(`你還沒確認的題目文字：最長 ${PHOTO_MAX_AGE_HOURS} 小時`);
    // 共用的解析不保證命中（快取只在第一次的結果合格時才寫入），不寫成「第二個人起 0 點」。
    expect(retention).toContain('共用的解析（同一題、同樣的作答已有共用的解析時 0 點）');
    expect(retention).not.toContain('第二個人起');
    expect(sectionText(PRIVACY_POLICY, '五、')).toContain('照片請只框題目，不要拍到姓名、學校');
    const four = sectionText(PRIVACY_POLICY, '四、');
    expect(four).toContain('你使用學習助手時');
    // 報告送出的設定與回饋（reportRequests.ts 的 <task> 與 <student_text role="feedback">）也寫出來。
    expect(four).toContain('產生學習報告時的目標、每週讀書時間、考試與段考日期、你寫的回饋與作答紀錄摘要');
  });

  it('服務條款：「三、AI 批改與學習助手」的點數與上限和程式一致、AI 聲明、「四」改字、新增「你上傳的題目」、「五、你的作品」不變', () => {
    const three = sectionText(TERMS_OF_SERVICE, '三、AI 批改與學習助手');
    expect(AI_TASK_POINTS.assist_ocr).toBe(2);
    expect(assistAnalyzePoints('item', 1)).toBe(6);
    expect(assistAnalyzePoints('item', 2) - assistAnalyzePoints('item', 1)).toBe(2);
    expect(assistAnalyzePoints('item', 99)).toBe(14);
    expect(three).toContain(
      `拍照轉錄 ${AI_TASK_POINTS.assist_ocr} 點、解析 ${assistAnalyzePoints('item', 1)} 點起（同一個題組每多一題加 ${assistAnalyzePoints('item', 2) - assistAnalyzePoints('item', 1)} 點，最多 ${assistAnalyzePoints('item', 99)} 點）、追問 ${AI_TASK_POINTS.assist_followup} 點、學習報告 ${AI_TASK_POINTS.assist_report} 點`,
    );
    expect(three).toContain('已經有共用的解析，而且你沒有另外寫疑問時，解析 0 點（實際扣點以送出後的結果為準）');
    expect(three).not.toContain('之前有人問過');
    expect(three).toContain(`學習報告每天 ${ASSIST_LIMITS.reportsPerDay} 份、拍照轉錄每天 ${ASSIST_LIMITS.ocrPerDay} 次`);
    expect(three).toContain(`中譯英 ${AI_TASK_POINTS.translation_grade} 點、英文作文 ${AI_TASK_POINTS.essay_grade} 點、手寫作文照片辨識 ${AI_TASK_POINTS.essay_ocr} 點`);
    expect(three).toContain('學習助手的解析與報告由 AI 產生，僅供參考，可能有錯誤；答案以題目頁或官方公布為準。');
    const four = sectionText(TERMS_OF_SERVICE, '四、使用規範');
    expect(four).toContain('試圖讓 AI 產生與學習無關的內容。');
    expect(four).not.toContain('與批改無關');
    expect(sectionText(TERMS_OF_SERVICE, '五、你的作品')).toContain('你寫的作文與翻譯，著作權屬於你');
    const upload = sectionText(TERMS_OF_SERVICE, '六、你上傳的題目');
    for (const phrase of ['只限你本人學習使用', '不要上傳整份講義或書', '題目的權利屬於原作者，由上傳的人負責', '不公開、不分享給其他使用者', '免費共用的解析只來自本站題庫與歷屆試題']) {
      expect(upload, phrase).toContain(phrase);
    }
    // 段號連續（一到十一），公開頁面的錨點 s-1…s-11 跟著順延。
    expect(TERMS_OF_SERVICE.sections.map((x) => x.heading.split('、')[0])).toEqual(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一']);
  });

  it('AI 處理說明：第一點涵蓋學習助手送出的內容（含學習報告的設定與回饋），勾選文字同一個範圍', () => {
    expect(AI_PROCESSING_NOTICE.summary[0]).toBe(
      '你送出 AI 批改或使用學習助手時，你的翻譯、作文（手寫作文是照片）、題目照片、題目文字、作答、提問，以及產生學習報告時的目標、每週讀書時間、考試與段考日期、你寫的回饋與作答紀錄的摘要會傳給 Anthropic, PBC 的 API 處理，處理地點可能在台灣境外（例如美國）。',
    );
    expect(AI_PROCESSING_NOTICE.summary[1]).toContain('請不要在作答、提問、回饋或照片裡留下真實姓名、學校、地址');
    const label = aiConsentLabel(AI_CONSENT_VERSION);
    for (const phrase of ['題目照片', '題目文字', '作答', '提問', '目標', '每週讀書時間', '考試與段考日期', '回饋', '作答紀錄的摘要']) {
      expect(AI_PROCESSING_NOTICE.summary[0], phrase).toContain(phrase);
      expect(label, phrase).toContain(phrase);
      expect(AI_PROCESSING_NOTICE.changes.join(''), phrase).toContain(phrase);
    }
  });

  it('這次新增的文字沒有「大考中心」或 CEEC', () => {
    const added = [
      ...PRIVACY_POLICY.changes,
      ...TERMS_OF_SERVICE.changes,
      ...AI_PROCESSING_NOTICE.changes,
      sectionText(TERMS_OF_SERVICE, '六、你上傳的題目'),
      ...[PRIVACY_POLICY, TERMS_OF_SERVICE, AI_PROCESSING_NOTICE].flatMap((d) => [...d.summary, ...d.sections.flatMap((x) => [...(x.paragraphs ?? []), ...(x.bullets ?? [])])]).filter((t) => t.includes('學習助手')),
    ].join('\n');
    expect(added).not.toMatch(/大考中心|CEEC/i);
  });
});

describe('safeNext', () => {
  it.each([
    ['/writing', '/writing'],
    ['/ai/apply?x=1', '/ai/apply?x=1'],
    [null, '/'],
    ['', '/'],
    ['writing', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/account/welcome', '/'],
    ['/account/welcome?next=/x', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});
