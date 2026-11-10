# 熟字僻義 1000：標 KK 音標

We are adding KK phonetic transcription (the system Taiwanese senior-high textbooks and dictionaries use) to a printed vocabulary handout. Each entry is a familiar English word taught in a less-known sense, so some words are heteronyms: the target sense may be pronounced differently from the familiar one (minute adj. 微小的, wind vi. 蜿蜒, bow n. 蝴蝶結, content adj. 滿足的, refuse n. 垃圾, row n. 爭吵, lead n. 鉛, tear vt. 撕, live adj. 現場的, close adj., use n., present vt., record vt., object vi., desert vt., conduct n./vt., contract vi., project vt., produce n., subject vt., perfect vt., permit n., survey vt., estimate n./vt., separate adj./vt., graduate n., alternate adj., associate n., moderate vt., deliberate vi., elaborate vi., excuse n., house vt., abuse n. …).

You are an expert in English phonetics who knows KK as printed in Taiwanese dictionaries.

## Input

`/tmp/claude-0/v1000/work/kk-N.in.json`: an array of 250 words. Each has `word`, `familiar` (the meaning students know), and `senses` (the target senses: `pos`, `zh`, `note`).

## Output

Write `/tmp/claude-0/v1000/work/kk-N.out.json`: a JSON object mapping each word to an array with **one KK string per sense, in the same order as `senses`**:

```json
{
  "address": ["əˋdrɛs", "əˋdrɛs"],
  "minute": ["maɪˋnjut"],
  "wind": ["waɪnd"]
}
```

Give the pronunciation of the word **in that sense and part of speech**, General American, the first pronunciation a Taiwanese dictionary lists. When a sense's `zh` or `note` refers to a derived form (e.g. "given", "provided", "learned /ˈlɝnɪd/", "customs"), still transcribe the headword itself in that part of speech.

## Notation (strict)

- No brackets or slashes; just the symbols.
- Primary stress: `ˋ` (U+02CB) placed **before** the stressed syllable. Secondary stress: `ˏ` (U+02CF) before its syllable. Monosyllabic words take no stress mark.
- Vowels: `i ɪ e ɛ æ ɑ ɔ o ʊ u ʌ ə ɝ ɚ aɪ aʊ ɔɪ`. Use `e` for the vowel of "day", `o` for "go", `ɝ` for stressed "bird", `ɚ` for unstressed "teacher", `ɪ` for final unstressed -y ("happy" `ˋhæpɪ`).
- Consonants: `p b t d k g f v θ ð s z ʃ ʒ h tʃ dʒ m n ŋ l r w j`, plus `hw` for "wh-" words as KK dictionaries print them (`hwaɪl`). Use plain ASCII `g`.
- Syllabic consonants as KK prints them: `ḷ` (U+1E37) and `ṇ` (U+1E47), e.g. "little" `ˋlɪtḷ`, "button" `ˋbʌtṇ`, "national" `ˋnæʃənḷ`.
- KK `ju` where Taiwanese dictionaries print it: "new" `nju`, "student" `ˋstjudṇt`, "produce" `prəˋdjus`.
- Examples: exceptional `ɪkˋsɛpʃənḷ`, outstanding `ˏaʊtˋstændɪŋ`, curriculum `kəˋrɪkjələm`, unusual `ʌnˋjuʒʊəl`, course `kors`, except `ɪkˋsɛpt`.

## Checks

Validate with `python3 -I`: valid JSON; every input word present; array length equals the number of senses; only the symbols listed above appear; every polysyllabic word has exactly one `ˋ`.

Then re-read the heteronyms and stress-shifting noun/verb pairs once more, sense by sense.

Return a short summary only: number of words, and the list of words where the senses got different pronunciations or where the target sense is pronounced differently from the familiar meaning.
