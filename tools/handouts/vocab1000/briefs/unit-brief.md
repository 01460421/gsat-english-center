# 熟字僻義 1000：寫一個單元（40 張字卡＋10 題仿學測詞彙題）

We are building a printed handout 「熟字僻義 1000」 for Taiwanese senior-high students preparing for the 學測 English exam: **familiar words used in a less-known but standard sense**. The book has 25 units of 40 words. Each unit ends with a 10-question quiz in the format of 學測 Part I (詞彙題, single choice).

You are an expert English lexicographer, a native-level writer, and a veteran Taiwanese senior-high English teacher who writes 學測-style test items. Accuracy matters more than speed: students will memorize what you write.

## Input

Your input file is `/tmp/claude-0/v1000/work/unit-XX.in.json` (XX given in your task). It is an array of 40 words, already in alphabetical order:

```json
{
  "word": "address", "level": 1,
  "familiar_zh": "地址（n.）",
  "targets": [{"pos": "vt.", "zh": "處理（問題）", "en": "to deal with a problem"}],
  "cands": [{"i": 1234, "exam": "110", "sec": "詞彙題", "s": "… to <<address>> the problem …"}]
}
```

- `familiar_zh` and `targets` are a proposal from an earlier pass. Treat them as a strong hint, not as truth: fix a wrong gloss or part of speech, drop a weak target, or add a better one.
- `cands` are sentences from past 學測 papers that contain the word in any sense (possibly none). `<<…>>` marks the answer of a blank.

## Output 1: entries

Write `/tmp/claude-0/v1000/work/unit-XX.out.json`:

```json
{
  "unit": 1,
  "entries": [ …40 entry objects, same order as the input… ],
  "quiz": [ …10 question objects… ],
  "doubts": [ {"word": "…", "issue": "…"} ]
}
```

Each entry:

```json
{
  "word": "address",
  "level": 1,
  "conversion": true,
  "common_zh": "地址（n.）",
  "senses": [
    {
      "pos": "vt.",
      "zh": "處理（問題）",
      "en": "to deal with a problem or difficult matter",
      "pattern": "address a problem / address an issue / address concerns",
      "example": "The mayor promised to [[address]] the housing shortage before the end of her first term.",
      "example_zh": "市長承諾在第一個任期結束前處理住房短缺的問題。",
      "note": ""
    }
  ],
  "gsat": [
    {"i": 1234, "sense": 0}
  ]
}
```

Rules for entries:

- `word`, `level`: copy from the input.
- `common_zh`: the meaning students already know, ≤10 字, with its part of speech in full-width parentheses, e.g. `天氣（n.）`.
- `conversion`: `true` when the familiar meaning and the first target sense are different parts of speech.
- `senses`: usually 1, at most 2 (a third only when all three are clearly exam-worthy). Each sense must be standard, current English, and clearly different from the familiar meaning. Never include a sense students already know.
  - `pos`: one of `vt.` `vi.` `v.` `n.` `adj.` `adv.` `prep.` `conj.`
  - `zh`: ≤14 字, Taiwan 繁體中文, the wording a Taiwanese dictionary or teacher would use. Use full-width parentheses for an implied object, e.g. `處理（問題）`.
  - `en`: a plain-English definition, ≤12 words.
  - `pattern`: 2–4 natural, high-frequency collocations separated by ` / `.
  - `example`: ORIGINAL sentence, 10–22 words. Do not copy 學測 sentences or dictionary examples. The context must force the target sense. Wrap the headword form in `[[ ]]` exactly once. Safe for minors; no brands, no real living people, no politics of Taiwan/China.
  - `example_zh`: natural Taiwan Mandarin translation with full-width punctuation. It must contain the `zh` sense (or an obviously equivalent wording).
  - `note`: optional, ≤22 字. Use it for a pronunciation change (e.g. `讀作 /maɪˈnjut/，重音在後`), a plural-only form, a common confusion, or a derived form. Empty string when not needed.
- `gsat`: for each target sense, look through `cands` and pick sentences that use the word **in that target sense** (not the familiar sense). At most 2 per entry; prefer sentences with `<<>>` on the headword, then more recent years, then shorter sentences. Give only `i` (the candidate's index) and `sense` (0-based index into `senses`). The build copies the sentence text itself, so never retype it. Use `[]` when no candidate matches. If the candidates show a 僻義 that the proposal missed and it is exam-worthy, add it as a sense.
- If a word has no genuine 熟字僻義 at all, still write the best entry you can and report it in `doubts` so the editor can replace it.

## Output 2: quiz (仿學測第一大題)

10 questions testing this unit's words in their 僻義:

```json
{
  "stem": "With sales falling for three years, the family bakery barely ______ the crisis by offering online orders.",
  "options": {"A": "tabled", "B": "weathered", "C": "seasoned", "D": "pocketed"},
  "answer": "B",
  "word": "weather",
  "sense": 0,
  "explain_zh": "weather＝平安度過（難關）。麵包店靠網路訂單撐過危機。"
}
```

Rules for the quiz:

- Format follows the 學測 vocabulary section: one sentence (occasionally two), 15–30 words, exactly one blank written as six underscores `______`, four single-word options.
- The correct answer is a headword of this unit used in one of its target senses (`word` = headword, `sense` = index in that entry's `senses`). Ten different headwords. Mix parts of speech as the unit allows (not all verbs).
- All four options are the same part of speech and the same inflected form (e.g. all `-ed`, all plural nouns), lowercase, and fit the blank grammatically.
- Distractors: take at least two of the three from this unit's other headwords when same-part-of-speech words are available; otherwise use common L2–L4 words. A distractor must be clearly wrong in **every** one of its senses, familiar or rare. Exactly one option may be correct.
- The sentence must contain enough context clues that a student who knows the 僻義 can be certain, and a student who only knows the familiar meaning would hesitate. Do not make the familiar meaning of the answer also fit.
- Topics like the real exam: school life, science, health, environment, technology, society, culture, travel. ORIGINAL sentences; do not reuse your entry examples or any 學測 sentence.
- Answer positions: each of A, B, C, D is used 2 or 3 times, in no obvious pattern.
- `explain_zh`: ≤45 字, Taiwan 繁體中文: `word＝僻義。` plus a one-clause paraphrase of the sentence.

## Before you finish

1. Re-read every entry as a strict lexicographer: is the sense real and current, is the part of speech right (vt. vs vi.), are the collocations natural, does the example force the sense, is the translation accurate and natural?
2. Solve each quiz question as a top student would, trying every option in every sense. Fix any question with zero or two defensible answers.
3. Validate with `python3 -I /tmp/claude-0/v1000/check_unit.py /tmp/claude-0/v1000/work/unit-XX.out.json` and fix everything it reports.

Return a short summary only: number of entries, number of entries with `gsat`, the answer string of the quiz (e.g. `BDACA CDBAD`), and the `doubts` list.
