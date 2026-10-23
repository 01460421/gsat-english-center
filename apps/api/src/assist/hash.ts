/** 學習助手的雜湊小工具（去重鍵、共用快取鍵）：sha256 的十六進位字串。 */
export async function sha256Text(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
