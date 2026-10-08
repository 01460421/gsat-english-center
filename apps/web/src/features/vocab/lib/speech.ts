/**
 * 發音：瀏覽器內建的 Web Speech API（speechSynthesis）。
 *
 * 用內建語音而不是預錄音檔：6,012 個字的音檔要另外處理授權與流量（04 文件 §7.1 的發音列），
 * 內建語音免費、離線也能用。缺點是聲音品質依裝置而定，不支援的瀏覽器（部分 App 內建瀏覽器）直接隱藏按鈕。
 */

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.speechSynthesis?.speak === 'function' &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** 挑英文語音：優先美式（學測以美式發音為主），其次任何英文語音；都沒有就交給瀏覽器用 lang 決定。 */
function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return english.find((v) => v.lang === 'en-US' && v.localService) ?? english.find((v) => v.lang === 'en-US') ?? english[0];
}

/** 朗讀英文。連按時先停掉上一段，不會排隊唸個不停。不支援時什麼都不做。 */
export function speak(text: string, rate = 0.9): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  const voice = pickVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}
