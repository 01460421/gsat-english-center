import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function CompositionPage() {
  return (
    <ModulePage page={getPage('/composition')}>
      <InfoSection title="學測怎麼考">
        <p>
          1 題、20 分，至少 120 個單詞。題型包括看圖寫作、信函寫作與主題寫作；111–115 學年度每年都要求「文分兩段」，
          並附有圖片或圖示提示。評分看內容、組織、文法句構、字彙拼字四個面向，給一個整體分數；字數明顯不足或未分段會各扣 1 分。
        </p>
      </InfoSection>
      <InfoSection title="拍照上傳手寫作文">
        <p>學測作文是手寫的，所以除了在網頁上打字，也可以直接拍下寫在紙上的作文交給 AI 批改。規劃中的流程：</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>在紙上或答題卷格式的練習紙上寫好作文。</li>
          <li>用手機拍照上傳（可以直接開相機，也可以從相簿選照片）。</li>
          <li>AI 先辨識手寫文字，你可以確認並修正辨識錯誤的地方，避免因為字跡被誤判而扣分。</li>
          <li>依四個評分面向給分與評語，標出文法、用字與拼字錯誤，並提供修改建議和 AI 範文。</li>
        </ol>
        <p className="font-medium">拍照小提醒</p>
        <ul>
          <li>光線充足、紙張平放，整頁入鏡，避免陰影與反光。</li>
          <li>字跡盡量清楚，塗改處畫線劃掉即可。</li>
        </ul>
        <p className="text-sm text-muted">
          隱私：照片只用來辨識文字，規劃上辨識完成後不保留原始照片；作文與批改結果可以自己刪除。AI 給的分數與範文僅供參考。
        </p>
      </InfoSection>
      <InfoSection title="其他規劃">
        <ul>
          <li>歷屆作文題目彙整與仿真命題。</li>
          <li>段落結構練習：主題句、支持細節、轉折語與結論。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
