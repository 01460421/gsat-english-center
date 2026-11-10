# 熟字僻義 1000：選字（提名）

We are building a printed handout 「熟字僻義 1000」 for Taiwanese senior-high students preparing for the 學測 English exam. Each entry is a **familiar word used in a less-known but standard sense** (熟字僻義) that a student would misread in a reading passage, cloze, or vocabulary question.

You are an expert English lexicographer and a veteran Taiwanese senior-high English teacher.

## Your slice

Your slice file lists words from the senior-high reference word list, one per line: `word<TAB>parts of speech<TAB>level (L1 easiest – L6 hardest)`.

Go through the slice **word by word, skipping none**, and nominate every word that has a genuine 熟字僻義.

## What counts

A word qualifies when all of these hold:

1. Students surely know one common meaning (the "familiar" meaning), usually learned in junior high or early senior high.
2. The target sense is clearly different from that meaning, so that knowing the familiar meaning does not let the student guess it.
3. The target sense is standard, current English that appears in news, non-fiction, fiction, or exam reading. All parts of speech count.

Examples across parts of speech:

- Verbs: address 處理（問題）, book 預訂, run 經營, house 收容, weather 平安度過, command 博得, observe 遵守, yield 產生, stand 忍受, count 重要, last 持續, spare 撥出；饒過, draw 吸引, bear 承受, fuel 助長, voice 表達, stage 舉辦, shoulder 承擔, land 得到（工作）, table 擱置, season 調味, champion 擁護, pocket 侵吞, tower 高聳, mirror 反映.
- Nouns: firm 公司, party 一方, cell 牢房, change 零錢, letter 字母, will 遺囑, pupil 瞳孔, temple 太陽穴, arms 武器, odds 機率, game 獵物, plant 工廠, story 樓層, school 魚群, capital 資本, interest 利益, fine 罰款, company 陪伴, bank 河岸, bill 鳥喙；法案, board 董事會, means 方法, minute（s）會議紀錄, quarter 地區, sentence 判刑, term 任期；條款, trunk 象鼻, spring 泉水, room 空間, race 種族, article 冠詞；條款, character 文字, figure 身材；人物, issue 期（刊）, line 行業, post 職位, row 爭吵.
- Adjectives and adverbs: grave 嚴重的, novel 新穎的, sound 合理的；健全的, minute 微小的, late 已故的, plain 樸素的；明白的, pretty 相當, fast 牢固地, fine 細微的, mean 吝嗇的, still 靜止的, sharp 整（點）, close 悶熱的, fair 白皙的, dear 昂貴的, even 平坦的；偶數的, odd 奇數的, rich 油膩的, critical 危急的, academic 純理論的, pressing 緊迫的, striking 顯著的, moving 感人的.
- Function words: while 雖然, yet 然而, but 除了, since 既然, as 隨著, for 因為, given 考慮到, save 除了.

## What to reject

- The meaning only exists in a phrasal verb or fixed idiom (the meaning must belong to the word itself; a particle may follow it).
- Slang, vulgar, archaic, dialect, or highly technical senses that would not appear in 學測-style reading.
- Trivial extensions of the familiar meaning, or a sense students already know (e.g. patient n. 病人, orange n. 橘子, light adj. 輕的, kind n. 種類, play n. 戲劇, watch n. 手錶, fly n. 蒼蠅, can n. 罐頭, park v. 停車, left adj. 左邊的, right n. 權利, like prep. 像, book n., train n./v. 訓練, mean v. 意思是, well adv.).
- Anything unsafe for minors (sexual, drugs, graphic violence).
- A word whose only familiar meaning is itself hard (most L5–L6 words): if students would not know the word at all, it is not a 熟字. L5–L6 words qualify only when the familiar meaning is truly well known.

## Rating

- **3** = classic, high-value 熟字僻義: common in reading and exams, and students often misread it.
- **2** = solid and useful.
- **1** = real but marginal (rarer, or closer to the familiar meaning).

Be thorough but honest: do not pad. A typical slice of 600 words yields roughly 120–220 nominations with rating 2 or 3.

## Output

Write a JSON array to your output file. One object per nominated word:

```json
{
  "word": "address",
  "level": 1,
  "rating": 3,
  "familiar_zh": "地址（n.）",
  "targets": [
    {"pos": "vt.", "zh": "處理（問題）", "en": "to deal with a problem"},
    {"pos": "n.", "zh": "演說", "en": "a formal speech"}
  ]
}
```

- `word`: exactly as in the slice file (base form). `level`: the number from the file.
- `familiar_zh`: the meaning students know, ≤10 字, with its part of speech in full-width parentheses.
- `targets`: 1–3 target senses, best first. `pos` is one of `vt.` `vi.` `v.` `n.` `adj.` `adv.` `prep.` `conj.`. `zh` ≤14 字, Taiwan 繁體中文. `en` ≤12 words.
- Sort alphabetically. Validate the file with `python3 -I` (valid JSON, every `word` is in your slice).

Return a short summary only: counts by rating, and up to 10 borderline words you were unsure about.
