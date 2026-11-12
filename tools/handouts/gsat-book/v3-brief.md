# 《學測英文秘笈》V3：歷屆詞彙題字彙總表（標註中文與搭配）

We are compiling a table for a printed GSAT (學測) English study book: every word that has appeared as an answer or an option in the vocabulary section of past 學測 papers (83–115 學年度). Students will memorize this table, so every gloss must be right.

You are an expert English lexicographer and a veteran Taiwanese senior-high English teacher.

## Input

`/tmp/claude-0/book/work/v3-N.in.json` (N given in your task): an array of about 255 objects:

```json
{"word": "allegation", "level": 5, "pos": "n.", "answer_years": ["113"], "times": 2}
```

- `level` is the word's level in the senior-high reference word list (null when the word is a derived form not listed there, e.g. "temporarily", "accomplishments").
- `answer_years`: the years in which it was the correct answer (may be empty).

## Output

Write `/tmp/claude-0/book/work/v3-N.out.json`: a JSON array, same order, one object per input word:

```json
{"word": "allegation", "head": "allegation", "pos": "n.", "zh": "指控；（未經證實的）說法", "colloc": "deny an allegation", "colloc_zh": "否認指控"}
```

- `word`: copy from the input.
- `head`: the form to print. Use the base form (singular noun, bare verb): "accomplishments" → "accomplishment". Keep adverbs and adjectives as they are ("temporarily").
- `pos`: the part(s) of speech students should learn for this word, at most two, from `n.` `v.` `adj.` `adv.` `prep.` `conj.`, joined by `/` (e.g. `v./n.`). Put first the part of speech in which the word is most likely tested in a vocabulary question.
- `zh`: the core meaning(s) in Taiwan 繁體中文, ≤14 字, the wording a Taiwanese dictionary or teacher uses. Give at most two meanings separated by `；`. Match the order of `pos`.
- `colloc`: ONE natural, high-frequency collocation or short phrase that shows how the word is used (2–5 words), e.g. "meet a deadline", "be eligible for", "a slender figure". It must contain the head word (an inflected form is fine).
- `colloc_zh`: its Chinese meaning, ≤10 字.

## Rules

- Accuracy first. If a word has several senses, choose the one(s) most useful for the exam.
- Taiwan usage only (no Mainland terms such as 信息、視頻、質量 for quality、水平 for level).
- Full-width Chinese punctuation; no English punctuation inside `zh`.
- No offensive or adult content in collocations.

## Checks

Validate with `python3 -I`: valid JSON; same length and same `word` order as the input; every field non-empty; `zh` ≤14 Han characters; `colloc` has 2–5 words and contains the head (or its first four letters); `colloc_zh` ≤10 Han characters.

Then re-read all entries once as a strict editor.

Return a short summary only: number of entries and up to 10 words you were unsure about.
