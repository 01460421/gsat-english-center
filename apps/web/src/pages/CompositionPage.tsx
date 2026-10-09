/**
 * 英文作文題型頁：頁首下面直接列出題目（和 /writing/essay 同一份列表，features/writing/EssayListPage.tsx 的 EssayPromptList；
 * 那裡加了新的題目，這裡也會跟著出現），點一題就到作答頁；下面是作答與批改方式、學測怎麼考、拍照上傳手寫稿的流程與照片隱私。
 * 說明要對得上實際功能：
 *   - 拍照流程：features/writing/components/PhotoPicker.tsx（拍照或選照片、前端縮圖、去 EXIF）→ EssayAttemptPage（上傳並辨識）
 *     → components/OcrConfirm.tsx（逐行確認、看不清楚處的候選字）→ 批改；
 *   - 批改結果：components/EssayResult.tsx（四項各 0–5、三個優先改進、逐段建議、原文錯誤標示、保留原意的參考改寫）；
 *   - 照片保存規則：features/account/policy.ts 隱私權說明第五點（改了那裡要一起改這裡）。
 */
import { AI_TASK_POINTS, PHOTO_MAX_COUNT } from '@gsat/shared';
import { Link } from 'react-router';
import { InfoSection, ModulePage } from '../components/ModulePage';
import { EssayPromptList } from '../features/writing/EssayListPage';
import { ListOrigin } from '../features/writing/lib/listOrigin';
import { useFeatures } from '../lib/api';
import { getPage } from '../modules';

const linkCls = 'font-medium text-primary underline underline-offset-2';

export default function CompositionPage() {
  // 後端沒部署（或登入、AI 沒開）時沒有登入入口，不能叫學生「登入並通過申請」。
  const features = useFeatures();
  const aiOpen = features.auth && features.ai;
  const photoOpen = aiOpen && features.ocr;
  return (
    <ModulePage page={getPage('/composition')}>
      {/* 從這裡點進作答頁，返回連結回到這一頁（不是 /writing/essay）。 */}
      <ListOrigin value="/composition">
        <EssayPromptList />
      </ListOrigin>
      <InfoSection title="作答與批改方式">
        <p>上面每一題都可以線上作答：</p>
        <ul>
          <li>打字作答：即時顯示字數與段數，草稿自動存在這台裝置；不用登入也能用檢核清單自我檢核，並依四個評分面向替自己打分數。</li>
          <li>
            {aiOpen
              ? `AI 批改：登入並通過申請後，由兩位 AI 評分者依內容、組織、文法句構、字彙拼字四個面向各給 0–5 分（滿分 20），在原文上標出錯誤，列出三個優先改進與逐段建議，也可能附上保留你原意的參考改寫${photoOpen ? '；手寫稿也可以拍照上傳' : ''}。`
              : 'AI 批改與拍照上傳手寫稿即將開放。'}
          </li>
        </ul>
        {aiOpen && (
          <p className="text-sm text-muted">
            AI 批改每篇扣 {AI_TASK_POINTS.essay_grade} 點{photoOpen ? `，手寫稿辨識另扣 ${AI_TASK_POINTS.essay_ocr} 點` : ''}，失敗全額退還。AI 的分數與改寫僅供參考，不是大考中心的正式評分。
          </p>
        )}
        {aiOpen && (
          <p>
            AI 批改的申請、剩餘點數與你的寫作紀錄在
            <Link to="/writing" className={`mx-0.5 ${linkCls}`}>
              寫作練習
            </Link>
            。
          </p>
        )}
      </InfoSection>
      <InfoSection title="學測怎麼考">
        <p>
          1 題、20 分，至少 120 個單詞。題型包括看圖寫作、信函寫作與主題寫作；111–115 學年度每年都要求「文分兩段」，並附有圖片或圖示提示。評分看內容、組織、文法句構、字彙拼字四個面向，給一個整體分數；字數明顯不足或未分段會各扣 1 分。
        </p>
      </InfoSection>
      <InfoSection title="拍照上傳手寫作文">
        <p>
          學測作文是手寫的，所以除了在網頁上打字，也可以把寫在紙上的作文拍照交給 AI 批改
          {photoOpen ? '（需要登入並通過 AI 批改申請）。流程：' : '。這個功能即將開放，開放後的流程：'}
        </p>
        <ol>
          <li>在紙上寫好作文，到作文的作答頁選「拍照上傳手寫稿」，直接開相機拍照或從相簿選照片（最多 {PHOTO_MAX_COUNT} 張）。</li>
          <li>照片先在你的手機上縮小、轉成 JPEG 並去除拍攝地點等資訊，預覽沒問題再上傳；原始照片不會離開你的裝置。</li>
          <li>AI 辨識手寫文字（{AI_TASK_POINTS.essay_ocr} 點）。</li>
          <li>你逐行確認、修正辨識結果：看不清楚的地方會標出來並列出候選字，全部處理完才能送出，避免因為字跡被誤判而扣分。</li>
          <li>AI 依四個評分面向批改（{AI_TASK_POINTS.essay_grade} 點），結果和打字作答一樣。</li>
        </ol>
        <p className="font-medium">拍照小提醒</p>
        <ul>
          <li>光線充足、紙張平放，整頁入鏡，避免陰影與反光。</li>
          <li>字跡盡量清楚，塗改處畫線劃掉即可。</li>
          <li>拍照前遮住姓名、學校等個人資料，不要入鏡。</li>
        </ul>
        <p className="text-sm text-muted">
          隱私：照片只用來辨識文字。辨識完成、你確認文字或自己刪除照片時，照片會立即刪除；就算流程中斷，最長也只保留 24 小時。照片不會出現在匯出資料裡，管理員也看不到；作文與批改結果可以自己刪除。詳見
          <Link to="/privacy" className={`mx-0.5 ${linkCls}`}>
            隱私權說明
          </Link>
          。
        </p>
      </InfoSection>
      <InfoSection title="陸續加入">
        <ul>
          <li>本站自撰的仿真作文題與範文。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
