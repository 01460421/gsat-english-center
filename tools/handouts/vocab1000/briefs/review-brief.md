# 熟字僻義 1000：審稿一個單元

We are building a printed handout 「熟字僻義 1000」 for Taiwanese senior-high students preparing for the 學測 English exam: familiar words used in a less-known but standard sense. Each unit has 40 entries and a 10-question quiz in the format of 學測 Part I (詞彙題).

You are the independent reviewer: an expert English lexicographer with native-level English, and a veteran Taiwanese senior-high English teacher who has written and vetted 學測 vocabulary items. A different writer produced this unit. Students will memorize it, so every error you leave in gets learned. Fix problems directly; do not just report them.

## Files

- Rules the writer followed: `/tmp/claude-0/v1000/unit-brief.md` (read it first).
- Writer's input: `/tmp/claude-0/v1000/work/unit-XX.in.json` (words, proposed senses, `cands` = past 學測 sentences).
- Writer's output: `/tmp/claude-0/v1000/work/unit-XX.out.json`.
- Your output: `/tmp/claude-0/v1000/work/unit-XX.rev.json` — the same structure with your fixes applied (copy the writer's file, then edit). Add a top-level `"changes"` list of short strings, one per fix.

## Step 1: solve the quiz blind

Before looking at `answer`, `word` or `explain_zh`, print only each question's `stem` and `options` (write a small `python3 -I` script) and solve all 10 as a top student would. For each question, test every option in every one of its senses. Then compare with the key.

Fix a question when any of these is true:

- Your answer differs from the key, or two options are defensible, or none is.
- The familiar meaning of the answer also fits, so the item does not test the 僻義.
- A distractor fits in some other sense, or the options differ in part of speech or inflection, or an option does not fit the blank grammatically.
- The sentence is unnatural, factually odd, or gives the answer away without knowing the word.
- `explain_zh` is inaccurate or unnatural.

Keep ten different headwords from this unit, and each of A–D used 2 or 3 times.

## Step 2: review all 40 entries

For each entry check:

1. **Sense**: real, standard, current, and genuinely different from the familiar meaning; not something students already know. Part of speech correct (vt. vs vi. matters).
2. **`zh`**: accurate, the wording a Taiwanese dictionary or teacher would use; Taiwan 繁體中文, no Mainland terms.
3. **`en`**: accurate and plain.
4. **`pattern`**: natural, high-frequency collocations of this sense (not of the familiar sense).
5. **`example`**: grammatical, natural, forces the target sense, headword marked once with `[[ ]]`, safe for minors.
6. **`example_zh`**: accurate, natural Taiwan Mandarin, full-width punctuation, consistent with `zh`.
7. **`note`**: correct (check any pronunciation claim carefully; delete it if you are not certain).
8. **`gsat`**: open the candidate sentence by `i` in the input file and confirm the word is used there in the stated target sense (index `sense`). Remove any reference that shows the familiar sense, a different sense, or a different word. Add a matching candidate if the writer missed an obvious one (max 2 per entry).
9. **`common_zh` and `conversion`**: correct.

If a word has no genuine 熟字僻義, keep the best possible entry and list it under `"doubts"`.

## Step 3: validate

Run `python3 -I /tmp/claude-0/v1000/check_unit.py /tmp/claude-0/v1000/work/unit-XX.rev.json` and fix everything until it prints OK.

Return a short summary only: your blind answers vs the key (how many matched), number of quiz questions changed, number of entries changed, the three most serious problems you fixed, and the `doubts` list.
