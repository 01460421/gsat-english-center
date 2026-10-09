#!/usr/bin/env python3
"""把各大題的出題規格合併成一份 data/exams/generation-spec.json，並做一致性檢查。

來源（不改動）：
  data/exams/generation-spec/*.json   各大題規格（vocabulary、cloze、word_bank、structure、reading、mixed、writing）
  data/exams/difficulty-bands.json    G50 分級規則、能力組、校準表、每題級別
  data/exams/parsed/*.json            檢查錨點與文件引用的考卷 id、題號；算答案字母與主題分布
  data/exams/item-stats.json          算各級「高分組最強誘答」的跨大題分布
  data/vocab/forms-index.json         算詞彙題正解在同卷其他大題重複出現的情形

檢查（任何一項失敗就以 1 結束，不寫檔）：
  1. 每個大題檔有 section、doc、format、tiers.{foundation,advanced,beyond_top}、checks、anchors、annotation_schema；
     tiers 的 band_id 對得上 G50 的 basic／advanced／top；doc 檔存在；annotation_schema 每個欄位有 type、location、required。
  2. 每條 check 都寫明 id、description、stage（pre／post）、severity（error／warn／info）、actor
     （program／blind_solver／auditor／human／cron，可用 + 串接）與 tier_scope（item／set），缺任何一項就報錯，不補預設值；
     tier_scope = item 的規則不得用 foundation／beyond_top 當鍵（題目級別一律 basic／advanced／top）；id 全域不重複。
  3. 每個錨點（anchors 底下任何含 exam 的物件）指到 data/exams/parsed 裡存在的考卷與題號 label，
     題號 no 與 label 一致，題目所屬大題類型符合該大題。
  4. tier_summary 的每個 JSON pointer 都取得到值。
  5. 模擬卷預設配比落在各大題 set_composition 的範圍內。
  6. docs/analysis/00-generation-spec.md 與 docs/analysis/sections/*.md 引用的考卷 id 與題號都存在。

用法（在 repo 根目錄執行）：
  python3 tools/build_generation_spec.py           # 產生並寫入 data/exams/generation-spec.json
  python3 tools/build_generation_spec.py --check   # 重新產生後與現有檔案比對，不同就以 1 結束

只用標準函式庫；輸出只取決於輸入檔內容（不含執行時間）。
"""
import argparse
import collections
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_DIR = ROOT / 'data/exams/generation-spec'
BANDS_PATH = ROOT / 'data/exams/difficulty-bands.json'
PARSED_DIR = ROOT / 'data/exams/parsed'
ITEM_STATS_PATH = ROOT / 'data/exams/item-stats.json'
FORMS_PATH = ROOT / 'data/vocab/forms-index.json'
OUT_PATH = ROOT / 'data/exams/generation-spec.json'
DOC = 'docs/analysis/00-generation-spec.md'
MD_GLOBS = [DOC, 'docs/analysis/sections/*.md']

SCHEMA_VERSION = '1.0'
SECTION_ORDER = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'writing']
TIER_KEYS = ['foundation', 'advanced', 'beyond_top']
TIER_BAND = {'foundation': 'basic', 'advanced': 'advanced', 'beyond_top': 'top'}
EXCLUDED_SECTION_KEYS = ['sources']  # 分析用的逐題標註，留在各大題檔，不併入
CURRENT_EXAMS = [f'gsat-{y}' for y in range(111, 116)]
GSAT_91_115 = [f'gsat-{y}' for y in range(91, 116)]

# 錨點可指到的題本大題類型（parsed 的 section.type）
SECTION_QTYPES = {
    'vocabulary': {'vocabulary'},
    'cloze': {'cloze'},
    'word_bank': {'word_bank'},
    'structure': {'structure'},
    'reading': {'reading'},
    'mixed': {'mixed', 'short_answer', 'other'},
    'writing': {'translation', 'composition'},
}

# 各題型摘要：值一律用 JSON pointer 從大題檔取出，不在這裡抄數字。
# {t} = foundation／advanced／beyond_top；{band} = basic／advanced／top；dict 表示三級各自的 pointer（None＝該級不適用）。
# 欄位名含 upper_group_pull 的值一律輸出成 [min, max]：pointer 名稱含 max 的純量是上限 → [0, v]，含 min 的是下限 → [v, 1]。
SUMMARY_POINTERS = {
    'vocabulary': {
        'target_P': '/tiers/{t}/target/P',
        'target_group_rate': '/tiers/{t}/target/target_group_rate',
        'near_miss_distractors': '/tiers/{t}/distractor_rules/near_miss_count',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/tiers/foundation/distractor_rules/target_top_third_pull_each',
            'advanced': '/tiers/advanced/distractor_rules/target_top_third_pull_strongest',
            'beyond_top': '/tiers/beyond_top/distractor_rules/target_top_third_pull_strongest',
        },
        'upper_group_pull_intended_challenge': {
            'foundation': None, 'advanced': None,
            'beyond_top': '/tiers/beyond_top/distractor_rules/intended_challenge/target_top_third_pull_strongest',
        },
        'expected_success_own_band_current': {
            'foundation': '/tiers/foundation/target/expected_band_success/basic_band',
            'advanced': '/tiers/advanced/target/expected_band_success/advanced_band',
            'beyond_top': '/tiers/beyond_top/target/expected_band_success/top_band',
        },
    },
    'cloze': {
        'target_P': '/tiers/{t}/target_stats/P/target_range',
        'near_miss_distractors': '/tiers/{t}/distractor_rules/near_miss_count',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/tiers/foundation/distractor_rules/upper_group_pull_target_max',
            'advanced': '/tiers/advanced/distractor_rules/upper_group_pull_target',
            'beyond_top': '/tiers/beyond_top/distractor_rules/upper_group_pull_target_min',
        },
        'expected_success_own_band_current': '/tiers/{t}/expected_correct_rate_for_band_students/gsat_current_cloze',
    },
    'word_bank': {
        'blank_target_P': '/blank_level_rules/{band}/target_P',
        'blank_tier_mix_per_passage': '/tiers/{t}/blank_tier_mix',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/blank_level_rules/basic/upper_top_distractor_max',
            'advanced': '/blank_level_rules/advanced/upper_top_distractor',
            'beyond_top': '/blank_level_rules/top/upper_top_distractor_min',
        },
        'expected_passage_mean_P': '/tiers/{t}/expected_passage_mean_P',
        'expected_success_own_band_recipe': '/tiers/{t}/expected_correct_rate_for_band_students/value',
    },
    'structure': {
        'target_P': '/tiers/{t}/target_stats/P_target_range',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/tiers/foundation/distractor_rules/upper_group_pull_target_max',
            'advanced': '/tiers/advanced/distractor_rules/upper_group_pull_target',
            'beyond_top': '/tiers/beyond_top/distractor_rules/upper_group_pull_target_min',
        },
        'expected_success_own_band_current': '/tiers/{t}/expected_correct_rate_for_band_students/gsat_current_structure',
    },
    'reading': {
        'target_P': '/tiers/{t}/P_target_range',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/tiers/foundation/distractor_rules/upper_pull_target_max',
            'advanced': '/tiers/advanced/distractor_rules/upper_pull_target',
            'beyond_top': '/tiers/beyond_top/distractor_rules/upper_pull_target',
        },
        'expected_success_own_band_current': '/tiers/{t}/expected_correct_rate_for_band_students/gsat_current_reading',
    },
    'mixed': {
        'multi_select_target_P': '/tiers/{t}/target_stats/multi_select/P',
        'written_target_score_rate': '/tiers/{t}/target_stats/written_score_rate',
        'upper_group_pull_strongest_distractor': {
            'foundation': '/tiers/foundation/target_stats/max_distractor_upper_pull',
            'advanced': '/tiers/advanced/target_stats/distractor_upper_pull/max_distractor',
            'beyond_top': '/tiers/beyond_top/target_stats/distractor_upper_pull/max_distractor',
        },
        'expected_section_score_of_10': '/set_composition/expected_section_score_for_band_students/{t}',
    },
    'writing': {
        'translation_L3plus_lemmas_per_pair': '/tiers/{t}/translation/L3plus_content_types_pair',
        'translation_reference_words_per_sentence': '/tiers/{t}/translation/reference_en_words_per_sentence',
        'translation_expected_rate_own_band': '/tiers/{t}/expected_score_for_band_students/translation_on_tier_items_rate',
        'composition_moves': '/tiers/{t}/composition/moves',
        'composition_expected_score_of_20_current_prompts': '/tiers/{t}/expected_score_for_band_students/composition_on_current_prompts_of20',
        'model_essay_target_score': '/tiers/{t}/model_essay/target_score',
        'model_essay_words': '/tiers/{t}/model_essay/words',
    },
}

# tier_summary 每列附官方樣本數：item_stats 依 difficulty-bands 的現制 111–115 該大題該級題數；
# 寫作與混合題書寫子題另用下列 pointer（年度數），作文是設計值（沒有統計級別）。
N_OFFICIAL_SPECIAL = {
    'writing': {'pointer': '/tiers/{t}/translation/reference_score_rate/n',
                'basis': '中譯英：G50-writing 落在該級的學測年度數（97–115；兩句一組）；作文三級是設計值，沒有統計級別'},
    'mixed': {'basis': '多選：現制 111–115 該級題數；書寫子題沒有逐題統計（n = 0，只有年度推估）'},
}
PROVISIONAL_N = 10

# 模擬卷預設的三級題數（第 1–46 題＋第 49 題，共 47 題有官方分級的選擇題）。
# 檢查會確認每一列都落在該大題 set_composition 的範圍內（ranges 的 pointer）。
MOCK_DEFAULT = {
    'vocabulary': {'counts': {'basic': 5, 'advanced': 3, 'top': 2},
                   'fixed': '/set_composition/mock_section_10/tier_mix'},
    'cloze': {'counts': {'basic': 4, 'advanced': 3, 'top': 3},
              'ranges': '/set_composition/mock_section_10/tiers_per_10'},
    'word_bank': {'counts': {'basic': 3, 'advanced': 4, 'top': 3},
                  'ranges': '/set_composition/mock_section/blank_tier_mix'},
    'structure': {'counts': {'basic': 2, 'advanced': 1, 'top': 1},
                  'ranges': '/set_composition/mock_section/tiers_per_4'},
    'reading': {'counts': {'basic': 6, 'advanced': 4, 'top': 2},
                'ranges': '/set_composition/mock_section_12'},
    'mixed': {'counts': {'basic': 1, 'advanced': 0, 'top': 0},
              'note': '第 49 題多選用穩定基礎或進階（官方 3／1／1）；書寫子題（47、48、50）沒有官方逐題統計，不計入，設計為進階～超越頂標'},
}

TIERS = {
    'foundation': {
        'label_zh': '穩定基礎', 'band_id': 'basic', 'target_group': 'Pc', 'group_percentiles': [40, 60],
        'target_standard': '均標', 'audience': '均標 → 前標',
        'gsat_levels_111_115': '8–11 級分（111 年 8–11；112–115 年 8–10）',
        'condition': 'round(Pc×100) >= 50',
    },
    'advanced': {
        'label_zh': '進階練習', 'band_id': 'advanced', 'target_group': 'Pb', 'group_percentiles': [60, 80],
        'target_standard': '前標', 'audience': '前標 → 頂標',
        'gsat_levels_111_115': '11–12 級分（111 年只有 12 級分）',
        'condition': 'round(Pc×100) < 50 and round(Pb×100) >= 50',
    },
    'beyond_top': {
        'label_zh': '超越頂標', 'band_id': 'top', 'target_group': 'Pa', 'group_percentiles': [80, 100],
        'target_standard': '頂標', 'audience': '頂標 → 15 級分',
        'gsat_levels_111_115': '13–15 級分',
        'condition': 'round(Pb×100) < 50',
        'flags': ['challenge：Pa < .50，在超越頂標裡最後才出', 'low_upper_discrimination：D1 = Pa − Pb < .10，不當錨點'],
    },
}

PRECEDENCE = [
    '大題的數字參數（目標 P、配比、門檻、檢核）以 data/exams/generation-spec/<section>.json 為準；本檔的 sections.<section> 是它的複本（去掉 sources）。',
    '跨大題的共通規則（common_rules、pipeline、calibration、global_checks）以本檔為準；大題規格有更嚴的規定時從嚴。',
    '與 docs/SPEC.md 不同之處列在 spec_conflicts，站主決定前生成依本規格，審核時照列出的差異判讀。',
    '分級一律依 difficulty-bands.json 的 G50；歷屆題的 tier 以 difficulty-bands.json 為準。',
]

COMMON_RULES = {
    'vocabulary_level': {
        'wordlist': 'data/vocab/ceec-wordlist.json（111 年版，6,012 筆，L1–6）；先用 data/vocab/forms-index.json 精確比對，查不到時才套 derivation_fallback（唯一一份回退表）',
        'official_scope': '以 4,500 字詞為主，可參考第一至第五級，偶爾第六級（02 §2.1）；115 實卷「大多用字在四級以下」',
        'whole_paper_calibration_115': {'L1_4': 0.909, 'L1_6': 0.952, 'off_list': 0.048, 'source': 'SPEC §3.4（04 §5.4）'},
        'level_is_not_a_difficulty_lever': '正解級別與答對率：詞彙 ρ −.12（學測 91–115）、綜合現制 +.36、文意選填現制 +.03、閱讀篇平均 |ρ| ≤ .07；唯一例外是中譯英（兩句 L3 以上詞目數，合併 ρ −.44）',
        'rules': [
            '級別門檻只用來控制閱讀負荷；難度靠各大題的誘答與詞義設計（tier_summary）。',
            '正解與選項最高 L6。詞彙題的 L6 正解只能走超越頂標路線 B（annotation route = B，每 10 題 ≤1）；路線 A 與穩定基礎、進階的詞彙選項最高 L5。',
            '其他大題的選文、選項與正解可以有 L5–6（現制 111–115 選文含 L6 字：綜合 10/10 篇、文意選填 4/5、篇章 4/5、閱讀 13/15；閱讀正解 6 題、綜合正解 1 題是 L6），由各大題的覆蓋率、beyond-L4、選項生字與 answer_level_dist 門檻控制。',
            '表外字必須是表內字的透明衍生或複合字，或上下文可推的主題字；各大題有各自的上限。',
            '選文的覆蓋率與 beyond-L4 依大題門檻（passage_thresholds），算法依 coverage_method_by_section；同一算法才能比較。',
        ],
        'derivation_fallback': {
            'applies': 'forms-index 精確比對查不到的 token；依序套用下列規則，第一個查得到的就用（級別沿用原字，依 docs/research/03-vocab-list.md §9.3）',
            'order': [
                {'rule': 'number_words', 'what': '拼出來的基數、序數詞（one、two、hundred、first、tenth、dozen…）算 L1'},
                {'rule': 'contractions', 'what': "can't→can、won't→will、cannot→can；字尾 n't、's、're、've、'll、'd、'm 與複數所有格 ' 去掉後查"},
                {'rule': 'hyphen_compound', 'what': '連字號複合字：每一段都查得到（含本表規則）才算表內，級別取最高的一段；任一段查不到就是表外'},
                {'rule': 'regular_inflection', 'what': '-s／-es／-ies→-y、-ed／-ied→-y、-ing（含去 e、雙寫子音）還原成表內字'},
                {'rule': 'suffix', 'what': '-ly（-ily→-y、-ally→-al、-bly→-ble、-ly→-le）、-ness（-iness→-y）、-less；去掉後再走屈折還原'},
                {'rule': 'prefix', 'what': 'un-、in-、im-、ir-、il-、non-、re-；剩下的部分 ≥3 個字母，且精確、屈折或字尾規則查得到'},
            ],
            'not_fallback': ['-er／-or／-ant', '-ful', '-able', '-ment（表內 (n.) 變體已在 forms-index）', '-ity', '-ation', '-ize', 'dis-', 'mis-', 'over-', 'under-', '閉合複合字（riverbank）'],
            'not_fallback_reason': '研究 03 §9.3：這些衍生字在大考詞彙表另有條目與級別（或刻意不收），查不到就是表外字，例如 forceful、hikers、advancement',
            'proper_nouns': '大寫開頭且精確比對與回退都查不到的 token 視為專有名詞，不進分母（詞彙題幹同）',
            'beyond_l4': 'beyond-L4 比例一律只用精確比對（同 data/exams/stats/passages.json），不套回退',
            'implementation': 'tools/text_metrics.py（生成前必須進 repo 並實作本表；目前 official_111_115_pass 用分析腳本依本表重算）',
            'examples': {'three': 'L1（number_words）', 'careless': 'care 的級別（suffix）', 'unhappily': 'happy 的級別（prefix＋suffix）',
                         'well-qualified': '取 well、qualified 較高者', 'forceful': '表外', 'hikers': '表外', 'riverbank': '表外'},
        },
        'coverage_method_by_section': {
            'vocabulary': '題幹：forms-index＋derivation_fallback（不計專有名詞）',
            'cloze': 'forms-index＋derivation_fallback；beyond-L4 用精確比對',
            'word_bank': '只用 forms-index 精確比對（同 data/exams/stats/passages.json；分母是全部字數，不排除專有名詞）',
            'structure': 'forms-index＋derivation_fallback；beyond-L4 用精確比對',
            'reading': 'forms-index＋derivation_fallback；beyond-L4 用精確比對',
            'mixed': 'beyond-L4 用精確比對',
            'writing': 'forms-index＋derivation_fallback（參考譯文另可有 ≤1 個透明衍生字）',
            'note': '「精確」與「加回退」兩種算法對現制綜合測驗選文的 L1–4 覆蓋率中位數差約 3 個百分點（90.1% 對 92.8%）；tools/text_metrics.py 兩種都算，依大題宣告的算法比門檻',
        },
        'passage_thresholds_pointer': 'sections.<section>.tiers.<tier>.passage_overrides／passage（word_bank）／passage_overrides＋beyond_l4_max（mixed）',
    },
    'sense_classification': {
        'applies_to': '詞彙題正解、文意選填正解（annotation sense）',
        'enum': ['core', 'extended', 'conversion', 'idiom'],
        'steps': [
            '1. 程式初篩：用法詞性 u（answer_pos）。正解若是規則衍生或分詞形容詞（forms-index types 以 derived 開頭，或 -ed／-ing 形容詞、-ly 副詞），直接不算 conversion。'
            '否則若 lexicon.json 該詞目的 OEWN 義項中，詞性 u 的義項數 < 全部義項的 1/3（s 併入 a），標 conversion_candidate。',
            '2. 程式列出參照義：該詞性 OEWN 第一個義項的定義，以及 lexicon zh 中該詞性第一個釋義（以逗號、分號切開的第一段）。寫進 annotation sense_reference。',
            '3. 兩位獨立判讀者（不同工作階段）只回答一個是非題：「題幹用的意思是否就是參照義之一？」是 → core；否 → extended；'
            'conversion_candidate 且判讀者同意該詞性用法成立 → conversion；正解是慣用語中不透明的成分 → idiom。',
            '4. 兩位不一致時以 core 計，且該題宣告的 item_tier 降一級（或重寫該題）；不用單一 LLM 判讀定案。',
        ],
        'prescreen_agreement_with_manual_codes': {
            'current_50': '人工標 V 的 5 題中 4 題被標 conversion_candidate（112-7 counter、114-2 produce、114-9 graced、115-9 elbow；112-6 recall 的名詞義項占 5/12，未過篩），沒有誤標',
            'all_565': '人工 V 11 題中 6 題過篩，另有 15 題人工 C／E 被過篩；用字面詞性「不在詞彙表 pos」判定只命中 1/11（grace、elbow、remedy 的詞彙表詞性都含 v.），所以不用那個做法',
        },
        'rubric': [
            {'item': 'gsat-115#10', 'key': 'grave', 'reference': 'adj. 第一義項 dignified and somber／莊重的', 'used': 'grave concerns（嚴重的）', 'label': 'extended'},
            {'item': 'gsat-113#3', 'key': 'due', 'reference': 'owed and payable／到期的', 'used': '公車預定到站', 'label': 'extended'},
            {'item': 'gsat-113#5', 'key': 'stand', 'reference': 'be standing／站', 'used': 'stand the test of time', 'label': 'extended'},
            {'item': 'gsat-112#9', 'key': 'choked', 'reference': 'breathe with great difficulty／窒息', 'used': 'choked with traffic', 'label': 'extended'},
            {'item': 'gsat-115#9', 'key': 'elbow', 'reference': '動詞義項只占 2/7', 'used': 'elbow one\'s way（動詞）', 'label': 'conversion'},
            {'item': 'gsat-114#2', 'key': 'produce', 'reference': '名詞義項只占 1/8', 'used': 'fresh seasonal produce（名詞）', 'label': 'conversion'},
            {'item': 'gsat-114#9', 'key': 'graced', 'reference': '動詞義項只占 2/9', 'used': 'grace … with one\'s presence', 'label': 'conversion'},
            {'item': 'gsat-113#7', 'key': 'credit', 'reference': 'n. 第一義項 approval', 'used': 'take the credit for', 'label': 'core',
             'note': '原人工碼 E；依本規則是 core＋強搭配，在詞彙題靠搭配撐難度'},
            {'item': 'gsat-112#2', 'key': 'pose', 'reference': '名詞義項 3/9（未過 1/3 門檻）；zh 姿勢', 'used': 'adopt an elegant pose', 'label': 'core'},
            {'item': 'gsat-112#6', 'key': 'recall', 'reference': '名詞義項 5/12；zh 回憶', 'used': 'powers of recall', 'label': 'core',
             'note': '原人工碼 V；依本規則是 core'},
        ],
        'note': '舊標註（sources 的 C／E／V）是單一標註者的判讀，統計數字照舊引用；生成與稽核一律用本規則',
    },
    'annotations': {
        'location': ('標註放在 gsat-bank/v1 檔案：已存在於 annotations.explanations.items.<n> 的欄位（sense、clue_type、evidence、option_codes、'
                     'option_evidence、option_notes_zh、source_token、transform、partial_credit_forms、interchangeable_with）沿用原位置；'
                     '其餘設計欄位放新的 annotations.design（items.<n> 與 set）。DB_SCHEMA §5.3 由負責人同步新增 design 這個 kind'),
        'schema_pointer': 'sections.<section>.annotation_schema（item_fields、option_fields、set_fields、enum_aliases）',
        'tiers': {'group': 'gsat-bank/v1 的 tier ∈ {basic, advanced, top}（對應本規格 tiers 的 foundation／advanced／beyond_top，見 tier_keys）',
                  'item': 'annotations.design.items.<n>.item_tier ∈ {basic, advanced, top}，每題必填'},
        'tier_scope': ('checks 的 tier_scope = item：規則依題目宣告的 item_tier 套用，鍵用 basic／advanced／top；'
                       'tier_scope = set：依題組 tier 套用，鍵用 foundation／advanced／beyond_top（另有 mock 鍵給模擬卷）；'
                       'value_ref 裡的 {tier} 一律指 sections.<section>.tiers 的鍵'),
        'enum_aliases': 'sources、observed、anchors 裡的分析代碼（例如詞彙 C／E／V、文意選填 ext／conv）對照各大題 annotation_schema.enum_aliases；生成標註一律用 enum',
    },
    'blind_solver_output': {
        'per_item_fields': {
            'answer': '盲解者選的答案',
            'confidence': 'low／medium／high',
            'locally_plausible': '只讀該題（格）所在句子時也說得通的其他選項（不含正解）',
            'feasible_in_context': '讀完全文（題組）後仍然可行的選項（含自己選的答案）',
        },
        'use': [
            'GEN-SOL-01、WB-UNQ-01、WB-DIS-02、STR-DIS-01、RD-DIS-03、MIX-MUL-03、VOC-17 只看 feasible_in_context：必須只含正解；兩位的聯集寫進 annotations.elimination.feasible。',
            '文意選填的分級（近似對、難格群，WB-DIS-01）只看 locally_plausible：basic 格 0 個、advanced 格 1 個、top 格 1–2 個；難格群＝本句皆可通、全文只有一個可行指派。',
            '其他大題的 locally_plausible 只記錄，不判定。',
        ],
    },
    'curriculum': {
        'source': 'data/curriculum/english-108.json（學習表現 95 條、學習內容 52 條）',
        'rule': '每個題組與每篇範文標 curriculum_codes（code_ascii）與 mapping_source = "inferred"；代碼必須存在於 english-108.json；至少含該大題 1 個主要學習表現',
        'primary_codes_by_section_pointer': 'english-108.json ceec_gsat_english_alignment.question_type_mapping_inferred.rows[].primary_learning_performances',
        'starred_items': '星號（*）條目不整條排除在穩定基礎之外，只調整深淺（01 §7.1）',
        'scope': '學測以普通型高中部定必修為範圍（02 §2.1）；取材避免冷僻艱深（課綱實施要點）',
    },
    'grammar_sources': {
        'patterns': 'data/curriculum/grammar-patterns.json：108 個句型（15 類）、111 個轉承詞、286 個片語；typical_use：translation 43、composition 34、cloze 3、all 28；59 個有龍騰版課次對照',
        'rule': '綜合測驗文法格、中譯英句構、範文的目標句型都要宣告 grammar_pattern_id（存在於 grammar-patterns.json）；清單沒有的句型另開 PR 增補，不在生成時臨時發明',
        'evidence': [
            '單獨的文法選擇題只出現在學測 83–90；現制文法考在綜合測驗的 G 格（現制 7/50 格，都要讀上下文才判斷得出：時態或體貌 3、情態 2、定動詞對分詞 1、介系詞＋which 1）。',
            '中譯英 119 句沒有一句的唯一正解需要倒裝、假設語氣或強調句；這些只能列為加分寫法。',
        ],
    },
    'topics_and_sdgs': {
        'evidence_current_passages': 'gsat-111–115 有選文的題組 40 個（見 global_evidence.topics_current）',
        'rules': [
            '說明文為主；一件物品、地方或現象的「來龍去脈」最常見（08 §5.2）。',
            '每個批次（lot）主題配額：起源與演變 3、科普與健康 2–3、文化歷史 2、社會議題 1（SPEC §5.2、08 §6.1）。',
            '每批至少一半的選文標 SDG；寫法從具體事件或物件切入，不寫政策宣導。',
            '主題、SDG 與難度無顯著關係（閱讀 SDG 題 P .60 對 .575，p = .26），不能拿主題調難度。',
            '同一份模擬卷各題組主題不重複；避開政治立場、真實姓名、自傷與暴力細節（WRT-TRN-TOP-01）。',
        ],
    },
    'materials_and_licensing': {
        'rules': [
            '「多來源事實 → AI 原創文章 → 附參考連結」：生成者只拿事實單（數字、日期、因果、人名地名，附網址、取得日期、授權），不拿來源原文（SPEC §5.3、04 §7.2）。',
            '可改作的開放文字只限 CC BY 來源（Global Voices 非合作媒體稿、Frontiers for Young Minds、PLOS）；CC BY-SA 改作另標 share_alike 並獨立存放。',
            '禁止清單照 04 §7.4（Cambridge、Oxford、Guardian 等不爬、不交給模型；The Conversation、UN 網站文章不改寫）。',
            '與來源原文不得有 ≥12 字連續相同；與 data/exams/parsed 任何題本的題幹、選文、選項不得有 ≥8 字連續相同（題幹先遮掉規格列出的題幹框架，見 GEN-SIM-01）。',
            '大考中心的答案、評分原則、佳作與參考譯文不交給生成者當範本；repo 文件只以考卷 id＋題號引用，至多引短語。',
            '統計錨點（anchors_index 的 statistical_anchor 不是 false）給審核者對照難度；參考與設計示範群組只看格式與設計。生成時只給錨點的標註與一行說明，不給題目原文。',
        ],
        'similarity_thresholds_words': {'sources': 12, 'past_papers': 8},
    },
    'distractors': {
        'evidence_pointer': 'global_evidence.distractor_pull_current／distractor_pull_gsat_91_115',
        'rules': [
            '低分組不是設計對象：任何同詞性、形式可行的誘答都會分到低分組約兩到三成。',
            '級別由「最強誘答吸走多少高分組（前 33%）」決定；各大題各級的目標帶見 tier_summary.*.upper_group_pull_strongest_distractor。',
            '每個誘答都要：標錯誤類型碼與預期強度（weak／medium／strong）、寫出排除它的原文字串、放回題目後確定是錯的。',
            '穩定基礎不放近似誘答；進階恰 1 個；超越頂標 1–2 個強誘答（詞彙題一般題恰 1 個，intended_challenge 題 1–2 個），而且正解仍唯一（盲解與稽核）。',
            '表面技巧對高分組無效：絕對字、與原文字面重疊、誘答字級高低都不影響高分組（閱讀字面重疊 ρ +.03；詞彙誘答比正解低／同級／高的高分組陷阱率 11%／10%／11%）。',
            '選項形式平行：同詞性、同字形變化、長度相近；正解不可是唯一最長或唯一用生字的選項。',
            '上線後每個誘答至少 5% 選答（n ≥ 100 時 < 2% 記 dead_distractor）。',
        ],
        'code_tables_pointer': {
            'vocabulary': 'sections.vocabulary.tiers.*.distractor_rules（近似干擾 near_miss）',
            'cloze': 'LF／CN／LR／GN／SF／SS（sections.cloze.tiers.beyond_top.distractor_rules.type_to_code_default）',
            'word_bank': 'LF／GF／LO／SY／CO／TP／SF／XP（docs/analysis/sections/03-word_bank.md §3.2）',
            'structure': '鄰格正解、多餘句 TR／SC／CT／FL／RD（sections.structure.tiers.*.distractor_rules）',
            'reading': 'sections.reading.distractor_taxonomy.codes（TI、TN、OP、SP、OG、DS、NM、LS、CX、SF、NA、VS、MT、PL）',
            'mixed': 'PT／CT／NM／PL／ST／ST*（sections.mixed.tiers.*.distractor_rules）',
            'writing': '誘錯點（sections.writing.tiers.*.distractor_rules）',
        },
    },
    'answer_balance': {
        'evidence_pointer': 'global_evidence.answer_letters_current',
        'rules': [
            '同一批（lot）四選一題，每個答案字母占 20–30%（SPEC §5.4）。',
            '模擬卷四選一題（第 1–20、35–46 題，共 32 題）每個字母 6–10 次，連續同字母 ≤ 2。',
            '詞彙 10 題每個字母 1–4 次；綜合測驗 10 格每個字母 1–4 次、同一篇同字母 ≤ 2；閱讀同一篇同字母 ≤ 2。',
            '文意選填答案是 A–J 的排列，相鄰兩格連續字母最長連 2 個，|ρ(字母序, 格序)| ≤ .6。',
            '篇章結構第一格答案不是 A，多餘句不放最後一個字母，第 k 格答第 k 個字母至多 1 格。',
            '混合題多選：同一批 20 題，每個字母當鍵的比例 ≤ 30%。',
        ],
    },
    'cross_item_leakage': {
        'evidence_pointer': 'global_evidence.vocabulary_key_reuse_current',
        'rules': [
            '同一篇選文：綜合測驗正解字串、文意選填任何選項字串不得出現在選文其他位置（現制都是 0/50）；篇章選項與選文沒有 ≥8 字相同字串。',
            '閱讀正解要改寫：與選文最長相同字串，穩定基礎 ≤5 字、進階以上 ≤3 字。',
            '同一題組：任一題的題幹或選項不得透露另一題的答案或證據句；盲解者逐題回報「是否能由同組其他題得知答案」。',
            '同一批或同一份模擬卷：正解不重複；詞彙題正解若在其他大題出現（官方 6/50 有同詞目重複），不得與該題的關鍵搭配詞同句出現。',
            '混合題簡答的答案在文中只出現一次；多選選項不得逐字重述填空的來源句。',
        ],
    },
    'set_difficulty_check': {
        'method': '題組的目標帶預期答對率 E = 各小題 global_evidence.band_success_matrix.by_section[大題][小題 item_tier][目標帶] 的平均（權重依配分）；不用 all 列',
        'target': 0.70,
        'acceptable_by_section_pointer': 'sections.<section>.set_composition（各大題建議組合與預期值）',
        'status': 'informational',
        'note': 'E 完全由宣告的配比決定，配比合規就必然落在建議值，所以 GEN-SET-01 只檢查配比、E 只輸出不判定；前提是生成題確實落在宣告的級別，上線後由 calibration 驗證',
    },
}

PIPELINE = [
    {'step': 1, 'name': '批次規格', 'actor': '開發者',
     'what': '選大題、級別、數量（每批 ≤40 組）、主題配額、要避開的近期正解與主題',
     'output': 'data/bank/lots/{lot}.json', 'spec_ref': 'SPEC §5.2 步驟 1'},
    {'step': 2, 'name': '事實單', 'actor': '代理',
     'what': '從授權白名單整理只有事實、沒有原句的清單；圖表資料存原始數據與出處',
     'output': 'data/bank/facts/*.json', 'spec_ref': 'SPEC §5.2 步驟 2、§5.3'},
    {'step': 3, 'name': '生成', 'actor': '代理',
     'input': ['本檔 tier_rule、common_rules', 'sections.<section>.format、tiers.<tier>、set_composition、annotation_schema、checks（stage = pre）', '錨點的標註（不含原文）', '事實單'],
     'what': '依 gsat-bank/v1 產生題組，連同 annotation_schema 要求的標註（線索字串、誘答碼與強度、證據句、句構與誘錯點、範文）',
     'output': '題組 JSON', 'spec_ref': 'SPEC §5.2 步驟 3'},
    {'step': 4, 'name': '自動檢核', 'actor': '程式（tools/validate_bank.py）',
     'what': '跑該大題 stage = pre 且 actor 含 program 的 checks，加上 global_checks 中 actor 含 program 的項目；不過直接退回步驟 3（不算一次失敗）',
     'output': "item_reviews(kind='program')", 'spec_ref': 'SPEC §5.2 步驟 4、§5.4'},
    {'step': 5, 'name': '獨立模型驗證', 'actor': '兩個全新工作階段的代理（B 用不同模型）＋程式',
     'what': '盲解 A、B（每題輸出 common_rules.blind_solver_output）；誘答稽核；唯一解程式檢查（文意選填完美配對、篇章指派、多選逐選項，都用 feasible_in_context）；中譯英盲譯；範文評分代理；actor 含 blind_solver 或 auditor 的大題 checks',
     'output': 'blind_solver ×2、distractor_audit、unique_solution', 'spec_ref': 'SPEC §5.2 步驟 5–7、§5.5–5.6'},
    {'step': 6, 'name': '相似度與事實核對', 'actor': '程式＋人工抽查',
     'what': '與來源 ≥12 字、與歷屆題本 ≥8 字的連續相同字串；文章與圖表數字對回事實單',
     'output': 'similarity、fact_check', 'spec_ref': 'SPEC §5.2 步驟 8'},
    {'step': 7, 'name': '判定', 'actor': '程式',
     'what': '全部通過才進入入庫；不過時附意見重生一次，連續兩次不過標 rejected',
     'output': '檔案 status', 'spec_ref': 'SPEC §5.7'},
    {'step': 8, 'name': '入庫與人工審核', 'actor': 'GitHub CI＋站主',
     'what': 'PR → CI → 匯入 D1（needs_review）；抽樣：校準期每個「題型 × 提示詞版本」前 30 組 100%、超越頂標 100%、任何 warn 100%、記為 needs_review 的題（例如 VOC-16 查不到搭配）100%（不占抽樣名額），其他 20%；上架時 tier_basis = spec',
     'output': "item_reviews(kind='human')、published", 'spec_ref': 'SPEC §5.2 步驟 10–12、§5.8'},
    {'step': 9, 'name': '上線監控與校正', 'actor': 'Cron＋站主',
     'what': '依 calibration 規則重算級別、檢查誘答與鑑別度，結果回饋規格',
     'output': '復審清單、改級建議、規格修訂', 'spec_ref': 'SPEC §3.6、§5.9'},
]

CALIBRATION = {
    'qualified_responses': 'first_exposure = 1、attempt_no = 1、hints_used = 0、saw_answer = 0、rapid = 0、scaffold = 0、answer_hash 與目前版本相同（SPEC §3.6）',
    'upper_lower_groups': '站內統計的高／低分組一律用前／後 33%（大考中心定義；推估式只適用 33%）；SPEC §3.6、§5.9 寫的 27% 要改',
    'grouping_methods': [
        {'id': 'theta_band', 'preferred': True,
         'how': '以作答過的歷屆錨題（官方五組答對率已知）估學生 θ，再用學測母體的五等分切點分組：θ ≥ 0.84 為 Pa，0.25–0.84 為 Pb，−0.25–0.25 為 Pc，−0.84–−0.25 為 Pd，低於 −0.84 為 Pe；每組答對率直接套 G50'},
        {'id': 'mock_total', 'preferred': False,
         'how': '同一份模擬卷依總分分五組；只代表站內考生，不等於學測母體，只當參考'},
        {'id': 'imputation', 'preferred': False,
         'how': '只有 P、Ph、Pl（前／後 33%）時，用 difficulty-bands.json rule.imputation 推估 Pc、Pb、Pa；前提是站內母體和學測相近（錨題站內 P 與官方 P 相關 ≥ .70）'},
    ],
    'min_n': {'responses_per_item_version': 200, 'per_target_and_adjacent_group': 30,
              'note': '200 是各大題規格一致的門檻；每組 30 是設計值'},
    'decision': [
        '重算級別與宣告相同 → 保留，tier_basis 改為 online。',
        '不同，且決定級別的組答對率離 .50 至少 5 個百分點 → 改級建議（Phase 2–4 送人工；Phase 5 依 SPEC §3.6 的可信區間條件自動改級）。',
        '不同但離 .50 不到 5 個百分點 → 保留、繼續累積（推估式在門檻 ±5 點內的準確率只有 86.1%）。',
        '超越頂標 D1 < .10，或任一誘答在高分組多於正解 → 隔離復審（可能雙答案）。',
    ],
    'monitoring_from_spec_5_9': [
        '同一題「答案有誤／兩個答案」回報 ≥3 位不同學生 → 隔離＋復審',
        '首次作答 ≥50：高分組選某誘答多於正解 → 隔離＋復審',
        '首次作答 ≥30：答對率 <15% 或 >95% → 復審',
        '首次作答 ≥100：高低分組答對率差 <0.15 → 復審',
        '某誘答 <2%（n ≥100）→ 記 dead_distractor，回饋規格',
    ],
    'writing': 'WRT-CAL-01／02（中譯英每句帶內平均、作文三帶中位數約 9／12／15，相鄰兩帶差 <2 送複審）；混合題 MIX-CAL-05（Claude 判分人工複核一致率 ≥ .95）',
    'feedback_metrics': [
        'tier_hit_rate：每個「大題 × 級別 × 出題配方」中，上線重算級別等於宣告級別的比例；累積 30 題後低於 .50 就修訂配方（設計值）。',
        'band_success_observed：各帶學生在各級題的實際答對率，對照 band_success_matrix；偏離 ±.10 就檢討。',
        'distractor_pull_observed：各級高分組最強誘答的中位數，對照 tier_summary 的目標帶。',
        'anchor_drift：錨題站內 P 與官方 P 的相關 ≥ .70（SPEC §3.6）；低於門檻時停用推估式。',
        '規格修訂產生新版本；題目記錄 spec_version，舊題不受影響。',
    ],
}

GLOBAL_CHECKS = [
    {'id': 'GEN-FMT-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': '題組符合 gsat-bank/v1，並宣告 section_type、tier（basic／advanced／top，對應本規格 foundation／advanced／beyond_top）與 generation.spec_id'},
    {'id': 'GEN-ANN-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'item',
     'description': '依 sections.<section>.annotation_schema 驗證標註：必填欄位齊全（含每題 item_tier）、型別與列舉正確、放在指定位置；線索字串、證據句、cue_spans 都能在選文中逐字找到',
     'rule': {'schema_pointer': 'sections.<section>.annotation_schema', 'verbatim_fields': ['clue_strings', 'key_collocate', 'evidence', 'cue_spans', 'exclusion_clue', 'exclusion_span', 'source_token']}},
    {'id': 'GEN-CUR-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': 'curriculum_codes 每個代碼存在於 english-108.json，mapping_source = inferred，至少含該大題 1 個主要學習表現'},
    {'id': 'GEN-GRM-01', 'stage': 'pre', 'severity': 'warn', 'actor': 'program', 'tier_scope': 'item',
     'description': '文法格、中譯英句構、範文目標句型宣告 grammar_pattern_id，且存在於 grammar-patterns.json'},
    {'id': 'GEN-VOC-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': '選文、題幹、選項的級別指標落在該大題該級範圍（算法依 common_rules.vocabulary_level.coverage_method_by_section 與 derivation_fallback）；詞彙題的 L6 正解只能是 route B（每 10 題 ≤1），其他大題的 L5–6 由各自門檻控制'},
    {'id': 'GEN-TOP-01', 'stage': 'pre', 'severity': 'warn', 'actor': 'program', 'tier_scope': 'set',
     'description': '每篇選文標 topic、domain、sdgs；同一批 ≥50% 的選文帶 SDG；同一份模擬卷主題不重複'},
    {'id': 'GEN-LIC-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': '每篇選文有事實單或 CC BY 來源與 attribution_text；來源不在禁止清單'},
    {'id': 'GEN-SIM-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': '與來源原文沒有 ≥12 字連續相同；與 data/exams/parsed 所有題本的題幹、選文、選項沒有 ≥8 字連續相同。題幹比對前先遮掉規格列出的題幹框架（sections.*.format.stems.templates 的固定字），只比框架以外的內容',
     'rule': {'source_max_shared_tokens': 11, 'past_paper_max_shared_tokens': 7,
              'past_paper_fields': ['stem', 'passage', 'passage_parts', 'options', 'options_bank'],
              'stem_frame_exemption': {
                  'frames_from': 'sections.*.format.stems.templates',
                  'how': '模板以 X、…、N、Nth、(about X) 等佔位字切開，各段固定字串視為框架；生成題幹中與某個模板框架逐字相符的部分先換成佔位符號，再做 n-gram 比對（標註 stem_template 指明用了哪個模板）',
                  'reason': '規格自己的閱讀題幹範本填入內容後就會和官方題幹有 ≥8 字相同（例如 According to the passage, which of the following is true about 與 74 題相同）'}}},
    {'id': 'GEN-ANS-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program', 'tier_scope': 'set',
     'description': '答案字母分布符合 common_rules.answer_balance'},
    {'id': 'GEN-LEAK-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program+blind_solver', 'tier_scope': 'set',
     'description': '符合 common_rules.cross_item_leakage（選文內不洩題、題組內不互洩、同批正解不重複）'},
    {'id': 'GEN-DIS-01', 'stage': 'pre', 'severity': 'error', 'actor': 'program+auditor', 'tier_scope': 'item',
     'description': '每個誘答依 annotation_schema 標錯誤類型碼、預期強度與排除理由；近似或強誘答數符合該大題該級（依題目 item_tier）'},
    {'id': 'GEN-SOL-01', 'stage': 'pre', 'severity': 'error', 'actor': 'blind_solver', 'tier_scope': 'item',
     'description': '兩位盲解者（兩個獨立工作階段、B 用不同模型、各解 1 次）答案都等於標準答案、信心 ≥ medium，而且 feasible_in_context（讀全文後仍可行的選項）只含正解。locally_plausible（只讀本句也說得通）不要求為空：文意選填的分級就靠它（WB-DIS-01），其他大題只記錄',
     'rule': {'sessions': 2, 'distinct_models': True, 'runs_per_session': 1, 'answer_equals_key': True,
              'confidence_min': 'medium', 'feasible_in_context': 'only_key', 'locally_plausible': 'not_checked',
              'fields': 'common_rules.blind_solver_output'}},
    {'id': 'GEN-AUD-01', 'stage': 'pre', 'severity': 'error', 'actor': 'auditor', 'tier_scope': 'item',
     'description': '誘答稽核沒有任何 arguably_acceptable；每個判定引用的原文逐字存在'},
    {'id': 'GEN-UNQ-01', 'stage': 'pre', 'severity': 'error', 'actor': 'blind_solver+program', 'tier_scope': 'set',
     'description': '唯一解（用兩位盲解者 feasible_in_context 的聯集）：文意選填完美配對數 = 1、篇章可行指派數 = 1（多餘句每格都不可行）、多選逐選項判斷一致'},
    {'id': 'GEN-SET-01', 'stage': 'pre', 'severity': 'warn', 'actor': 'program', 'tier_scope': 'set',
     'description': '題組各級題數（依每題 item_tier）符合該大題 set_composition；另輸出用 band_success_matrix.by_section 算的目標帶預期答對率 E，只供參考、不判定（common_rules.set_difficulty_check）'},
    {'id': 'GEN-REV-01', 'stage': 'pre', 'severity': 'error', 'actor': 'human', 'tier_scope': 'set',
     'description': '人工審核抽樣：校準期 100%、超越頂標 100%、任何 warn 100%、needs_review（例如 VOC-16 查不到搭配）100% 且不占抽樣名額、其他 20%'},
    {'id': 'GEN-CAL-01', 'stage': 'post', 'severity': 'warn', 'actor': 'cron', 'tier_scope': 'item',
     'description': '≥200 筆合格作答（目標組與相鄰組各 ≥30）後依 G50 重算級別，依 calibration.decision 處理'},
    {'id': 'GEN-CAL-02', 'stage': 'post', 'tier_scope': 'item', 'severity': 'warn', 'actor': 'cron',
     'description': '高分組（前 33%）最強誘答落在該大題該級目標帶；任一誘答在高分組多於正解（n ≥ 50）→ 隔離復審'},
    {'id': 'GEN-CAL-03', 'stage': 'post', 'tier_scope': 'item', 'severity': 'warn', 'actor': 'cron',
     'description': '超越頂標 D1 ≥ .10；高低分組答對率差 < .15（n ≥ 100）→ 復審'},
    {'id': 'GEN-CAL-04', 'stage': 'post', 'tier_scope': 'item', 'severity': 'warn', 'actor': 'cron',
     'description': '錨題站內 P 與官方 P 相關 ≥ .70（每題 n ≥ 100）；不到就停用 P／Ph／Pl 推估式'},
    {'id': 'GEN-CAL-05', 'stage': 'post', 'tier_scope': 'item', 'severity': 'info', 'actor': 'cron',
     'description': '誘答選答 < 2%（n ≥ 100）記 dead_distractor，回饋規格'},
]

SPEC_CONFLICTS = [
    {'spec_ref': 'SPEC §3.1／§3.3', 'spec_says': 'θ70 分級（3PL）', 'this_spec': '歷屆題 tier 以 G50（difficulty-bands.json）為準；θ70 只留作連續量尺與線上校正', 'evidence': '學測題兩者一致 85.8%；G50 不需擬合，45 年都能用', 'section': 'all'},
    {'spec_ref': 'SPEC §3.3', 'spec_says': '多選以拿到滿分為答對（c = 0）', 'this_spec': '多選一律用得分率 P 分級與校正，全對率 T 另存', 'evidence': '官方 P、Pa–Pe 都是得分率；T 只有 P 的 .18–.65 倍', 'section': 'mixed'},
    {'spec_ref': 'SPEC §3.4', 'spec_says': '各大題篇長帶（例：綜合穩定基礎 140–180、閱讀超越頂標 340–420、混合題 380–450）', 'this_spec': '依 tier_summary／passage_thresholds 的大題範圍', 'evidence': '篇長與難度無關；SPEC 多個帶落在現制範圍外（綜合現制最短 179、閱讀歷屆最長 390、混合題最長 399）', 'section': 'cloze/word_bank/structure/reading/mixed'},
    {'spec_ref': 'SPEC §3.4', 'spec_says': '覆蓋率帶，未指定算法', 'this_spec': '各大題宣告算法（衍生字回退或精確比對）', 'evidence': '兩種算法差約 3 個百分點，會讓現制選文是否落在進階帶的結論相反', 'section': 'all'},
    {'spec_ref': 'SPEC §3.5 詞彙題', 'spec_says': '穩定基礎線索在同一子句；超越頂標 ≥2 個近義干擾；正解 L4–6', 'this_spec': '不限線索範圍；超越頂標一般題 1 個近似干擾（拉力 .20–.30），intended_challenge 題 1–2 個（每 10 題 ≤3）；正解以 L2–4 延伸義／轉品為主（約 70%）＋L5–6 核心義', 'evidence': '跨子句不比較難（P .59 對 .58）；現制每題平均 1.62 個高分組陷阱；現制超越頂標 13 題中 9 題是 L2–4 延伸義或轉品', 'section': 'vocabulary'},
    {'spec_ref': 'SPEC §3.5 綜合測驗', 'spec_says': '超越頂標 ≥2 格要看篇章；穩定基礎正解 L1–4', 'this_spec': '用誘答強度定級；穩定基礎正解 L1–4 ≥75%', 'evidence': 'W 格 22% 是超越頂標、S 格 28%；現制穩定基礎 4/19 格正解 L5–6', 'section': 'cloze'},
    {'spec_ref': 'SPEC §3.5 文意選填', 'spec_says': '以「詞性相容選項數」分級；超越頂標含片語動詞；1 格詞彙聯結', 'this_spec': '以詞義類型＋同組近似誘答＋難格群分級；片語動詞不是條件；詞彙聯結列為可選', 'evidence': '同組選項數與 P 的 ρ −.27（現制）、−.10（學測 91–115）；現制片語動詞正解 8 格只有 1 格是超越頂標', 'section': 'word_bank'},
    {'spec_ref': 'SPEC §3.5 篇章結構', 'spec_says': '穩定基礎靠代名詞或轉折詞；進階 1 格主題句或總結句；超越頂標 ≥2 格無字面線索、多餘句能放進 ≥2 格', 'this_spec': '用線索強度、單側錨點、局部競爭定級；多餘句只瞄準 1 格', 'evidence': '連接詞格 P .505、17% 超越頂標；合併 18 格超越頂標只有 3 格無字面線索；官方 12 篇多餘句都只在 ≤1 格吸到高分組 ≥10%', 'section': 'structure'},
    {'spec_ref': 'SPEC §3.5 閱讀', 'spec_says': '以證據範圍分級；超越頂標推論、目的、事實意見、圖表整合 ≥2 題', 'this_spec': '以誘答強度與正解改寫程度分級；每種題型都有三級寫法', 'evidence': '現制單句證據題 P .48、跨段 .60；現制超越頂標以指涉（3/10）與結構（2/10）最多', 'section': 'reading'},
    {'spec_ref': 'SPEC §3.5 混合題', 'spec_says': '以多選選項數分級（6／6–8／8–10）', 'this_spec': '以 E2 鍵數、誤選碼別、填空轉換類別、簡答長度分級', 'evidence': '10 選項的 gsat-114 第 49 題是穩定基礎、D .67', 'section': 'mixed'},
    {'spec_ref': 'SPEC §3.5 中譯英', 'spec_says': '進階一句兩個句構；超越頂標 20–30 字', 'this_spec': '以 L3 以上詞目數＋至少一句改寫句構分級；超越頂標參考譯文 14–23 字', 'evidence': '句構數與年度得分只有邊緣關係（ρ −.34）；119 句參考譯文最長 23 字', 'section': 'writing'},
    {'spec_ref': 'SPEC §5.4', 'spec_says': '詞彙干擾不能與正解同 OEWN synset（判錯）', 'this_spec': '送人工確認，不直接判錯', 'evidence': '真題 gsat-113 第 1 題的 slender／slight 同 synset', 'section': 'vocabulary'},
    {'spec_ref': 'SPEC §4.6、§5.4', 'spec_says': '填空答案原形在文中、答案本身不在（逐格）；同 entry_id 給 1 分', 'this_spec': '逐題幹檢查；部分給分用 entry_id ∪ lexicon family ∪ 宣告的 partial_credit_forms，官方閱卷實例列為回歸測資', 'evidence': '官方 10 格中 2 格主要答案逐字在文中；innovative 與 innovation 不同 entry_id，官方給一半', 'section': 'mixed'},
    {'spec_ref': 'SPEC §5.4、§6.9', 'spec_says': '範文 ≥120 字；穩健版 15–16、頂標版 19–20', 'this_spec': '範文依級別：14–16 分 160–240 字、16–18 分 220–330 字、19–20 分 300–450 字', 'evidence': '現制佳作 46 篇全部 ≥265 字，中位數 369', 'section': 'writing'},
    {'spec_ref': 'SPEC §3.6、§5.9', 'spec_says': '前後 27% 答對率差', 'this_spec': '前／後 33%', 'evidence': '大考中心 45 個年度都是 33%；推估式以 33% 擬合', 'section': 'all'},
    {'spec_ref': 'SPEC §3.6', 'spec_says': 'Phase 5：n ≥ 50 且 b 的 80% 可信區間落在另一帶才自動改級', 'this_spec': 'G50 重算需 ≥200 筆；兩條件並用，Phase 2–4 只出改級建議', 'evidence': '各大題規格的 CAL-01 都用 200', 'section': 'all'},
    {'spec_ref': '08 §6', 'spec_says': '閱讀每篇 330–370 字；篇章 4 格依序為主題句、轉折、例證、總結；穩定基礎四級以內用字', 'this_spec': '模擬卷閱讀 290–370 字；篇章 TS／BR ≥1、SP ≤3、CL ≤1；用字門檻只控制閱讀負荷', 'evidence': '現制 15 篇中 6 篇 <330 字；現制 20 格只有 1 格轉折、2 格總結', 'section': 'reading/structure'},
]

KNOWN_LIMITATIONS = [
    '所有人工標註（詞義、題型、線索、誘答碼、句構）都是單一標註者，沒有一致性檢驗；建議每個大題由第二個代理盲標約 100 格算 κ。',
    '現制樣本小：詞彙 23／14／13、綜合 19／15／16、文意選填 20／17／13、篇章 8／8／4、閱讀 32／18／10、多選 3／1／1（basic／advanced／top）；寫作只有年度層級資料。',
    '事前特徵預測不了級別：逐卷留一決策樹的準確率低於全猜多數類（綜合 45.6% 對 47.1%、文意選填 47.6% 對 48.8%、篇章 55.2% 對 61.6%、閱讀 63.9% 對 65.0%），詞彙迴歸樹 R² 只有 .10。生成題的級別在上線前只是假設。',
    '選項分析只有前／後 33%，「高分組陷阱」是頂標組（前 20%）的近似。',
    '指考題的級別相對於指考考生，只用來界定超越頂標的上緣，不當學測校準錨點。',
    '混合題書寫子題與寫作沒有逐題統計：混合題書寫是年度反推值，寫作能力組是模型推估；作文三級是設計，不是統計分級。',
    '閱讀的數據圖表、表格、多文本在學測閱讀沒有官方題，難度先驗未校準。',
    '站內使用者不是學測母體；推估式與五標對應都要靠錨題檢查偏差。',
    '生成與盲解是同一系列模型，盲點可能相同（ROADMAP R6），靠超越頂標全審與上線監控補強。',
    'tools/text_metrics.py 還沒進本 repo：選文與題幹的覆蓋率要照 common_rules.vocabulary_level.derivation_fallback 實作後才能開始生成；目前的 official_111_115_pass 是分析腳本依同一張表重算的。',
    '詞義分類（common_rules.sense_classification）的程式初篩只對得上人工轉品碼 4/5（現制）、6/11（全部）；核心義與延伸義仍要兩位判讀者，一致率上線前要先在官方題上量。',
    '頂標以上帶的 θ（1.548）超出 Pa 點（1.40），band_success_matrix 的頂標以上欄取 Pa（clamp，偏保守）；延伸值另列 top_extrapolated。',
]


# ---------------------------------------------------------------- 小工具

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def rel(path):
    return str(Path(path).resolve().relative_to(ROOT))


def get_pointer(obj, pointer):
    cur = obj
    for part in pointer.strip('/').split('/'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            raise KeyError(pointer)
    return cur


def r3(x):
    return None if x is None else round(x + 0.0, 3)


def median(xs):
    return r3(statistics.median(xs)) if xs else None


def quartile(xs, q):
    """線性內插分位數（與 numpy 預設相同）。"""
    if not xs:
        return None
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return r3(s[lo] + (s[hi] - s[lo]) * (pos - lo))


# ---------------------------------------------------------------- 題本 label 索引

def load_parsed_index():
    index = {}
    papers = {}
    for path in sorted(PARSED_DIR.glob('*.json')):
        paper = load_json(path)
        labels = {}
        for sec in paper.get('sections', []):
            for grp in sec.get('groups', []):
                for q in grp.get('questions', []):
                    labels[q['label']] = {'no': q.get('no'), 'section': sec.get('type')}
        index[paper['id']] = labels
        papers[paper['id']] = paper
    return index, papers


# ---------------------------------------------------------------- 錨點

def iter_anchor_objects(obj, path):
    if isinstance(obj, dict):
        if isinstance(obj.get('exam'), str):
            yield path, obj
            return
        for k, v in obj.items():
            yield from iter_anchor_objects(v, path + [k])
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from iter_anchor_objects(v, path + [i])


def anchor_labels(a):
    if a.get('label'):
        return [str(a['label'])]
    if a.get('items'):
        return [str(x) for x in a['items']]
    if a.get('no') is not None:
        return [str(a['no'])]
    return []


ANCHOR_INDEX_KEYS = ('tier', 'P', 'flags', 'route', 'intended_challenge', 'basis', 'role', 'population',
                     'tier_g50_writing', 'design_tier', 'item_level_tier', 'design_intent_tier', 'year_written_tier_estimate')


def check_anchors(section, anchors, index, errors):
    out = []
    for path, a in iter_anchor_objects(anchors, []):
        where = f'{section}.anchors/{"/".join(str(p) for p in path)}'
        exam = a['exam']
        labels = anchor_labels(a)
        if exam not in index:
            errors.append(f'{where}: 考卷 {exam} 不在 data/exams/parsed')
            continue
        if not labels:
            errors.append(f'{where}: {exam} 沒有 label／items／no')
            continue
        for lab in labels:
            q = index[exam].get(lab)
            if q is None:
                errors.append(f'{where}: {exam} 沒有題號 label「{lab}」')
                continue
            if a.get('no') is not None and len(labels) == 1 and q['no'] != a['no']:
                errors.append(f'{where}: {exam} label「{lab}」的 no 是 {q["no"]}，錨點寫 {a["no"]}')
            if q['section'] not in SECTION_QTYPES[section]:
                errors.append(f'{where}: {exam} 第 {lab} 題屬於 {q["section"]}，不是 {section}')
        group = '/'.join(str(p) for p in path if not isinstance(p, int))
        entry = {'section': section, 'group': group, 'exam': exam, 'labels': labels}
        for k in ANCHOR_INDEX_KEYS:
            if k in a and a[k] not in (None, []):
                entry[k] = a[k]
        top = path[0] if path else None
        if top not in TIER_KEYS:
            entry['statistical_anchor'] = False  # 參考或設計示範群組，不是該級的統計錨點
        out.append(entry)
    return out


# ---------------------------------------------------------------- 大題檔檢查

def validate_section(key, d, bands_ids, errors):
    if d.get('section') != key:
        errors.append(f'{key}.json: section 欄位是 {d.get("section")!r}，應為 {key!r}')
    for field in ('format', 'tiers', 'checks', 'anchors', 'doc'):
        if field not in d:
            errors.append(f'{key}.json: 缺少 {field}')
    if 'doc' in d and not (ROOT / d['doc']).exists():
        errors.append(f'{key}.json: doc {d["doc"]} 不存在')
    tiers = d.get('tiers', {})
    for t in TIER_KEYS:
        if t not in tiers:
            errors.append(f'{key}.json: tiers 缺少 {t}')
            continue
        band = tiers[t].get('band_id')
        if band is None:
            band = d.get('tier_rule', {}).get('band_ids', {}).get(t)
        if band != TIER_BAND[t]:
            errors.append(f'{key}.json: tiers.{t}.band_id 是 {band!r}，應為 {TIER_BAND[t]!r}')
        if band not in bands_ids:
            errors.append(f'{key}.json: band_id {band!r} 不在 difficulty-bands rule.tiers')
    checks = d.get('checks')
    if not isinstance(checks, list) or not checks:
        errors.append(f'{key}.json: checks 必須是非空陣列')
    else:
        for c in checks:
            validate_check(f'{key}.json', c, errors)
    anchors = d.get('anchors', {})
    for t in TIER_KEYS:
        if not anchors.get(t):
            errors.append(f'{key}.json: anchors.{t} 是空的')
    validate_annotation_schema(key, d.get('annotation_schema'), errors)


CHECK_STAGES = ('pre', 'post')
CHECK_SEVERITIES = ('error', 'warn', 'info')
CHECK_ACTORS = ('program', 'blind_solver', 'auditor', 'human', 'cron')
CHECK_SCOPES = ('item', 'set')
SET_TIER_KEYS = ('foundation', 'beyond_top')


def has_set_tier_keys(obj):
    if isinstance(obj, dict):
        return any(k in SET_TIER_KEYS for k in obj) or any(has_set_tier_keys(v) for v in obj.values())
    if isinstance(obj, list):
        return any(has_set_tier_keys(v) for v in obj)
    return False


def validate_check(where, c, errors):
    """檢核欄位缺一不可，不補預設值。"""
    cid = c.get('id')
    for field in ('id', 'description', 'stage', 'severity', 'actor', 'tier_scope'):
        if not c.get(field):
            errors.append(f'{where}: check {cid} 缺少 {field}')
    if c.get('stage') and c['stage'] not in CHECK_STAGES:
        errors.append(f'{where}: check {cid} 的 stage {c["stage"]!r} 不在 {CHECK_STAGES}')
    if c.get('severity') and c['severity'] not in CHECK_SEVERITIES:
        errors.append(f'{where}: check {cid} 的 severity {c["severity"]!r} 不在 {CHECK_SEVERITIES}')
    if c.get('actor') and not all(a in CHECK_ACTORS for a in c['actor'].split('+')):
        errors.append(f'{where}: check {cid} 的 actor {c["actor"]!r} 不在 {CHECK_ACTORS}')
    if c.get('tier_scope') and c['tier_scope'] not in CHECK_SCOPES:
        errors.append(f'{where}: check {cid} 的 tier_scope {c["tier_scope"]!r} 不在 {CHECK_SCOPES}')
    if c.get('tier_scope') == 'item' and has_set_tier_keys(c.get('rule')):
        errors.append(f'{where}: check {cid} 是 item-scope，規則卻用 foundation／beyond_top 當鍵')


def validate_annotation_schema(key, sch, errors):
    if not isinstance(sch, dict) or not isinstance(sch.get('item_fields'), dict):
        errors.append(f'{key}.json: 缺少 annotation_schema.item_fields')
        return
    if 'item_tier' not in sch['item_fields']:
        errors.append(f'{key}.json: annotation_schema 缺少 item_tier')
    for group in ('item_fields', 'option_fields', 'set_fields'):
        for name, f in (sch.get(group) or {}).items():
            for need in ('type', 'location', 'required'):
                if need not in f:
                    errors.append(f'{key}.json: annotation_schema.{group}.{name} 缺少 {need}')
            if f.get('type', '').startswith('enum') and not f.get('enum'):
                errors.append(f'{key}.json: annotation_schema.{group}.{name} 是 enum 卻沒有列舉值')


def normalize_check(section, c):
    """checks_index 的一列：大題檔的 check 原樣保留（含 rule），只加上 section。"""
    entry = {'id': c['id'], 'section': section}
    entry.update({k: v for k, v in c.items() if k != 'id'})
    return entry


# ---------------------------------------------------------------- 摘要與配比

def as_range(name, pointer, value):
    """拉力欄位一律寫成 [min, max]。"""
    if 'upper_group_pull' not in name or isinstance(value, list):
        return value
    leaf = pointer.rsplit('/', 1)[-1]
    if 'min' in leaf:
        return [value, 1.0]
    if 'max' in leaf:
        return [0.0, value]
    raise ValueError(f'{name}：{pointer} 是純量，但名稱看不出是上限或下限')


def n_official(sec, t, sections, counts, errors):
    band = TIER_BAND[t]
    if sec == 'writing':
        ptr = N_OFFICIAL_SPECIAL['writing']['pointer'].format(t=t)
        try:
            n = get_pointer(sections[sec], ptr)
        except KeyError:
            errors.append(f'tier_summary：writing 取不到 {ptr}')
            n = None
        return {'n_official': n, 'provisional': n is None or n < PROVISIONAL_N,
                'n_basis': N_OFFICIAL_SPECIAL['writing']['basis']}
    n = counts['by_section'].get(sec, {}).get(band, 0)
    row = {'n_official': n, 'provisional': n < PROVISIONAL_N}
    if sec == 'mixed':
        row['n_official_written'] = 0
        row['n_basis'] = N_OFFICIAL_SPECIAL['mixed']['basis']
    else:
        row['n_basis'] = '現制 111–115 該大題該級題數（difficulty-bands）'
    return row


def resolve_summary(sections, counts, errors):
    out = {'note': f'每列附 n_official（官方樣本數）；n < {PROVISIONAL_N} 時 provisional = true，目標帶是暫定值'}
    for sec, fields in SUMMARY_POINTERS.items():
        out[sec] = {'doc': sections[sec]['doc']}
        for t in TIER_KEYS:
            row = {}
            for name, ptr in fields.items():
                p = ptr[t] if isinstance(ptr, dict) else ptr.format(t=t, band=TIER_BAND[t])
                if p is None:
                    continue
                try:
                    row[name] = as_range(name, p, get_pointer(sections[sec], p))
                except KeyError:
                    errors.append(f'tier_summary：{sec} 的 {name} 取不到 {p}')
                except ValueError as e:
                    errors.append(f'tier_summary：{e}')
            row.update(n_official(sec, t, sections, counts, errors))
            out[sec][t] = row
    return out


def check_mock_default(sections, errors):
    totals = collections.Counter()
    rows = {}
    for sec, spec in MOCK_DEFAULT.items():
        counts = spec['counts']
        totals.update(counts)
        rows[sec] = dict(counts)
        if 'fixed' in spec:
            fixed = get_pointer(sections[sec], spec['fixed'])
            want = {TIER_BAND[k]: v for k, v in fixed.items()}
            if want != counts:
                errors.append(f'mock_exam：{sec} 預設 {counts} 與規格固定配比 {want} 不同')
        if 'ranges' in spec:
            ranges = get_pointer(sections[sec], spec['ranges'])
            for band, n in counts.items():
                lo, hi = ranges[band]
                if not lo <= n <= hi:
                    errors.append(f'mock_exam：{sec} {band} {n} 不在 [{lo}, {hi}]')
        if 'note' in spec:
            rows[sec]['note'] = spec['note']
    return rows, {b: totals[b] for b in ('basic', 'advanced', 'top')}


# ---------------------------------------------------------------- 證據（由資料計算）

GROUP_THETA_CACHE = {}


def interval_mean_theta(lo_pct, hi_pct):
    nd = statistics.NormalDist()
    zlo = -math.inf if lo_pct <= 0 else nd.inv_cdf(lo_pct / 100)
    zhi = math.inf if hi_pct >= 100 else nd.inv_cdf(hi_pct / 100)

    def phi(z):
        return 0.0 if math.isinf(z) else nd.pdf(z)
    return (phi(zlo) - phi(zhi)) / ((hi_pct - lo_pct) / 100)


def logit(p):
    p = min(max(p, 0.005), 0.995)
    return math.log(p / (1 - p))


def success_at(item, theta, extrapolate=False):
    """同 tools/difficulty_bands.py success_at：五組點 logit 內插。
    三個練習帶的 θ 都 ≥ 0（Pc 組平均），只會用到 Pc、Pb、Pa 三點。
    頂標以上帶 θ 1.548 超出 Pa 點（1.40）：預設取 Pa（clamp）；extrapolate=True 延伸 Pb→Pa 線段。"""
    pts = [(0.0, logit(item['Pc'])), (interval_mean_theta(60, 80), logit(item['Pb'])),
           (interval_mean_theta(80, 100), logit(item['Pa']))]
    if theta < 0:
        raise ValueError('band θ < 0 需要 Pd、Pe')
    if theta >= pts[-1][0]:
        (t0, y0), (t1, y1) = pts[-2], pts[-1]
        y = y1 + (y1 - y0) * (theta - t1) / (t1 - t0) if extrapolate else y1
    else:
        for (t0, y0), (t1, y1) in zip(pts, pts[1:]):
            if t0 <= theta <= t1:
                y = y0 + (y1 - y0) * (theta - t0) / (t1 - t0)
                break
    return 1 / (1 + math.exp(-y))


def band_success_matrix(bands):
    band_theta = bands['ability_mapping']['band_mean_theta']
    acc = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
    for it in bands['items']:
        if it['exam'] not in CURRENT_EXAMS:
            continue
        for sec in (it['section'], 'all'):
            for band in ('basic', 'advanced', 'top'):
                acc[sec][it['tier']][band].append(success_at(it, band_theta[band]))
            acc[sec][it['tier']]['top_extrapolated'].append(success_at(it, band_theta['top'], extrapolate=True))
    out = {}
    for sec in ['all'] + [s for s in SECTION_ORDER if s in acc]:
        out[sec] = {}
        for tier in ('basic', 'advanced', 'top'):
            if tier not in acc[sec]:
                continue
            cell = {band: r3(statistics.fmean(v)) for band, v in acc[sec][tier].items()}
            cell['n'] = len(acc[sec][tier]['basic'])
            out[sec][tier] = cell
    return {
        'method': ('五等分組點（組內平均 θ, logit 答對率）線性內插，同 tools/difficulty_bands.py success_at；帶內平均 θ 取 difficulty-bands.json '
                   'ability_mapping.band_mean_theta；gsat-111–115 全部有分級的題。頂標以上帶 θ 超出 Pa 點，top 欄取 Pa（clamp，保守）；'
                   'top_extrapolated 延伸 Pb→Pa 的 logit 線段，只供對照'),
        'band_theta': {k: r3(v) for k, v in band_theta.items()},
        'rows_are_item_tier_columns_are_student_band': True,
        'by_section': out,
    }


def tier_counts_current(bands):
    c = collections.Counter()
    for it in bands['items']:
        if it['exam'] in CURRENT_EXAMS:
            c[(it['section'], it['tier'])] += 1
    by_section = {}
    for sec in SECTION_ORDER:
        row = {t: c[(sec, t)] for t in ('basic', 'advanced', 'top') if c[(sec, t)]}
        if row:
            by_section[sec] = row
    total = {t: sum(v.get(t, 0) for v in by_section.values()) for t in ('basic', 'advanced', 'top')}
    per_paper = {t: r3(v / len(CURRENT_EXAMS)) for t, v in total.items()}
    return {'by_section': by_section, 'total': total, 'mean_per_paper': per_paper}


def distractor_pull(item_stats, bands, exams):
    tier_of = {(it['exam'], it['label']): it['tier'] for it in bands['items']}
    acc = collections.defaultdict(lambda: collections.defaultdict(list))
    for exam in exams:
        e = item_stats['exams'].get(exam)
        if not e:
            continue
        for it in e['items']:
            if it.get('multi_select') or not it.get('key'):
                continue
            tier = tier_of.get((exam, it['label']))
            if tier is None:
                continue
            opts = it['options']
            key = it['key']
            others = [v for k, v in opts.items() if k != key]
            if not others or any(v.get('H') is None or v.get('L') is None for v in others):
                continue
            h = max(v['H'] for v in others)
            lo = max(v['L'] for v in others)
            a = acc[tier]
            a['H'].append(h)
            a['L'].append(lo)
            a['ge15'].append(h >= 0.15)
            a['ge20'].append(h >= 0.20)
            a['beats'].append(h >= opts[key]['H'])
    out = {}
    for tier in ('basic', 'advanced', 'top'):
        a = acc[tier]
        n = len(a['H'])
        out[tier] = {
            'n': n,
            'upper_strongest_median': median(a['H']),
            'upper_strongest_iqr': [quartile(a['H'], .25), quartile(a['H'], .75)],
            'lower_strongest_median': median(a['L']),
            'share_upper_ge_0.15': r3(sum(a['ge15']) / n) if n else None,
            'share_upper_ge_0.20': r3(sum(a['ge20']) / n) if n else None,
            'items_distractor_ge_key_in_upper': sum(a['beats']),
        }
    return out


def answer_letters_current(papers):
    total = collections.Counter()
    per_paper = {}
    max_run = {}
    for exam in CURRENT_EXAMS:
        seq = []
        for sec in papers[exam]['sections']:
            if sec['type'] not in ('vocabulary', 'cloze', 'reading'):
                continue
            for grp in sec['groups']:
                for q in grp['questions']:
                    if q.get('mode') == 'single_choice' and isinstance(q.get('options'), dict) and len(q['options']) == 4:
                        seq.append(q['answer'])
        c = collections.Counter(seq)
        total.update(c)
        per_paper[exam] = {k: c[k] for k in 'ABCD'}
        run = best = 1
        for a, b in zip(seq, seq[1:]):
            run = run + 1 if a == b else 1
            best = max(best, run)
        max_run[exam] = best
    n = sum(total.values())
    return {
        'scope': 'gsat-111–115 第 1–20、35–46 題（四選一單選）',
        'items': n,
        'total': {k: total[k] for k in 'ABCD'},
        'share': {k: r3(total[k] / n) for k in 'ABCD'},
        'per_paper': per_paper,
        'per_paper_letter_range': [min(min(v.values()) for v in per_paper.values()),
                                   max(max(v.values()) for v in per_paper.values())],
        'max_same_letter_run': max_run,
    }


def topics_current(papers):
    genre = collections.Counter()
    sdg = collections.Counter()
    by_section = collections.defaultdict(lambda: {'groups': 0, 'with_sdg': 0})
    n = with_sdg = 0
    for exam in CURRENT_EXAMS:
        for sec in papers[exam]['sections']:
            for grp in sec['groups']:
                tags = grp.get('tags')
                if not tags or not grp.get('passage') and not grp.get('passage_parts'):
                    continue
                n += 1
                genre[tags.get('genre')] += 1
                sdgs = tags.get('sdgs') or []
                by_section[sec['type']]['groups'] += 1
                if sdgs:
                    with_sdg += 1
                    by_section[sec['type']]['with_sdg'] += 1
                sdg.update(sdgs)
    return {
        'scope': 'gsat-111–115 有選文的題組（題本 tags）',
        'groups': n,
        'with_sdg': with_sdg,
        'genre': dict(sorted(genre.items(), key=lambda kv: (-kv[1], kv[0]))),
        'sdg_counts': {str(k): v for k, v in sorted(sdg.items(), key=lambda kv: (-kv[1], kv[0]))},
        'by_section': {s: by_section[s] for s in SECTION_ORDER if s in by_section},
    }


def vocabulary_key_reuse(papers, forms):
    def lemma(word):
        w = word.lower().strip(".,;:!?\"'()")
        e = forms.get(w)
        return e[0]['entry_id'].split('|')[0] if e else w

    hits = []
    n = 0
    for exam in CURRENT_EXAMS:
        keys = []
        texts = []
        for sec in papers[exam]['sections']:
            for grp in sec['groups']:
                if sec['type'] == 'vocabulary':
                    for q in grp['questions']:
                        keys.append((q['label'], q['options'][q['answer']]))
                    continue
                parts = [grp.get('passage') or '']
                parts += [(p.get('text') or '') for p in (grp.get('passage_parts') or [])]
                if isinstance(grp.get('options_bank'), dict):
                    parts += [str(v) for v in grp['options_bank'].values()]
                for q in grp['questions']:
                    parts.append(q.get('stem') or '')
                    if isinstance(q.get('options'), dict):
                        parts += [str(v) for v in q['options'].values()]
                words = {lemma(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]*", ' '.join(parts))}
                texts.append((sec['type'], words))
        for label, key in keys:
            n += 1
            lk = lemma(key)
            where = sorted({t for t, words in texts if lk in words})
            if where:
                hits.append({'exam': exam, 'label': label, 'lemma': lk, 'sections': where})
    return {'scope': 'gsat-111–115 詞彙題正解（同詞目，經 forms-index 還原）出現在同卷其他大題的文字',
            'keys': n, 'reused': len(hits), 'cases': hits}


def checks_counts(checks_index):
    by = collections.defaultdict(collections.Counter)
    for c in checks_index:
        by[c['section']][c['stage']] += 1
    out = {s: dict(sorted(by[s].items())) for s in SECTION_ORDER + ['global'] if s in by}
    tot = collections.Counter()
    for c in checks_index:
        tot[c['stage']] += 1
    out['total'] = dict(sorted(tot.items()))
    out['by_actor'] = dict(sorted(collections.Counter(c['actor'] for c in checks_index).items()))
    out['by_severity'] = dict(sorted(collections.Counter(c['severity'] for c in checks_index).items()))
    return out


# ---------------------------------------------------------------- 文件引用檢查

EXAM_RE = r'(?:gsat|ast|ref)-\d{2,3}(?:-makeup|-[ab])?'
DASH = '[–—-]'
PAT_EXAM = re.compile(r'\b(' + EXAM_RE + r')\b')
PAT_FULL = re.compile(r'\b(' + EXAM_RE + r')\s*第\s*(\d{1,2})(?:\s*' + DASH + r'\s*(\d{1,2}))?\s*題\s*(?:[(（]([A-Z])[)）])?')
PAT_LABEL = re.compile(r'\b(' + EXAM_RE + r')\s*((?:中譯英|翻譯|簡答|短詩)\d+|英文作文)(?:\s*' + DASH + r'\s*(\d))?')
PAT_SHORT = re.compile(r'(?<![\w.\-–/])(?:(gsat|ast)-)?(\d{2,3})-(\d{1,2})(?!\d)')


def label_exists(index, exam, number, suffix=''):
    labels = index.get(exam, {})
    lab = f'{number}{suffix}'
    if lab in labels:
        return True
    if not suffix:  # 47 → 47A、47B
        return any(l.startswith(str(number)) and l[len(str(number)):].isalpha() and len(l) == len(str(number)) + 1
                   for l in labels)
    return False


def exam_exists(index, exam):
    return exam in index or any(e.startswith(exam + '-') for e in index)  # ref-98 → ref-98-a／-b


def verify_markdown(index):
    files = []
    for pattern in MD_GLOBS:
        files += sorted(ROOT.glob(pattern))
    errors = []
    refs = 0
    if not (ROOT / DOC).exists():
        errors.append(f'{DOC} 不存在')
    for path in files:
        text = path.read_text(encoding='utf-8')
        name = rel(path)
        for m in PAT_EXAM.finditer(text):
            refs += 1
            if not exam_exists(index, m.group(1)):
                errors.append(f'{name}: 考卷 {m.group(1)} 不存在')
        for m in PAT_FULL.finditer(text):
            exam, a, b, sub = m.groups()
            for k in range(int(a), int(b or a) + 1):
                refs += 1
                if exam in index and not label_exists(index, exam, k, sub or ''):
                    errors.append(f'{name}: 「{m.group(0)}」：{exam} 沒有第 {k}{sub or ""} 題')
        for m in PAT_LABEL.finditer(text):
            exam, lab, b = m.groups()
            labs = [lab]
            if b and lab[-1].isdigit():
                base = lab.rstrip('0123456789')
                labs = [f'{base}{k}' for k in range(int(lab[len(base):]), int(b) + 1)]
            for one in labs:
                refs += 1
                if exam in index and one not in index[exam]:
                    errors.append(f'{name}: 「{m.group(0)}」：{exam} 沒有 {one}')
        for m in PAT_SHORT.finditer(text):
            kind, yr, no = m.groups()
            kind = kind or 'gsat'
            yr = int(yr)
            if kind == 'gsat' and not 83 <= yr <= 115 or kind == 'ast' and not 91 <= yr <= 110:
                continue
            exam = f'{kind}-{yr}'
            refs += 1
            if exam not in index or not label_exists(index, exam, int(no)):
                errors.append(f'{name}: 簡寫「{m.group(0)}」：{exam} 沒有第 {no} 題')
    return files, refs, errors


# ---------------------------------------------------------------- 主程式

def build():
    errors = []
    bands = load_json(BANDS_PATH)
    rule = bands['rule']
    bands_ids = [t['id'] for t in rule['tiers']]
    if bands_ids != ['basic', 'advanced', 'top'] or rule.get('id') != 'G50':
        errors.append(f'difficulty-bands.json rule 不是預期的 G50（tiers {bands_ids}）')
    index, papers = load_parsed_index()

    files = sorted(SPEC_DIR.glob('*.json'))
    found = [p.stem for p in files]
    if sorted(found) != sorted(SECTION_ORDER):
        errors.append(f'data/exams/generation-spec/ 的檔案 {found} 與預期 {SECTION_ORDER} 不同')
    raw = {p.stem: load_json(p) for p in files}

    sections = {}
    checks_index = []
    anchors_index = []
    for key in SECTION_ORDER:
        if key not in raw:
            continue
        d = raw[key]
        validate_section(key, d, bands_ids, errors)
        sections[key] = {k: v for k, v in d.items() if k not in EXCLUDED_SECTION_KEYS}
        sections[key]['source_file'] = rel(SPEC_DIR / f'{key}.json')
        for c in d.get('checks', []):
            checks_index.append(normalize_check(key, c))
        anchors_index += check_anchors(key, d.get('anchors', {}), index, errors)
    for c in GLOBAL_CHECKS:
        validate_check('GLOBAL_CHECKS', c, errors)
        checks_index.append(normalize_check('global', c))
    seen = collections.Counter(c['id'] for c in checks_index)
    for cid, n in sorted(seen.items()):
        if n > 1:
            errors.append(f'check id {cid} 重複 {n} 次')

    counts = tier_counts_current(bands)
    summary = resolve_summary(sections, counts, errors) if len(sections) == len(SECTION_ORDER) else {}
    mock_rows, mock_total = check_mock_default(sections, errors) if len(sections) == len(SECTION_ORDER) else ({}, {})

    item_stats = load_json(ITEM_STATS_PATH)
    forms = load_json(FORMS_PATH)['forms']
    imp = rule['imputation']
    tier_rule = {
        'id': rule['id'],
        'source': rel(BANDS_PATH),
        'statement': rule['statement'],
        'theta': rule['theta'],
        'comparison': rule['comparison'],
        'population': rule['population'],
        'anchor_condition': rule['anchor_condition'],
        'tiers': rule['tiers'],
        'flags': rule['flags'],
        'imputation': {
            'when': imp['when'],
            'coefficients': imp['coefficients'],
            'note_Pc': imp['note_Pc'],
            'leave_one_year_out_accuracy': imp['validation']['leave_one_year_out_accuracy'],
            'accuracy_near_threshold': imp['validation']['accuracy_near_threshold'],
        },
        'group_mean_theta': bands['ability_mapping']['group_mean_theta'],
        'group_percentiles': bands['ability_mapping']['group_percentiles'],
        'group_theta_cutpoints': {
            'Pe|Pd': r3(statistics.NormalDist().inv_cdf(0.2)),
            'Pd|Pc': r3(statistics.NormalDist().inv_cdf(0.4)),
            'Pc|Pb': r3(statistics.NormalDist().inv_cdf(0.6)),
            'Pb|Pa': r3(statistics.NormalDist().inv_cdf(0.8)),
        },
        'band_mean_theta': bands['ability_mapping']['band_mean_theta'],
        'standard_percentile_definition': bands['ability_mapping']['standard_percentile_definition'],
        'standard_reached_in_group_91_115': bands['ability_mapping']['gsat_summary'],
        'calibration_P_gsat_current': {
            'all': {t: bands['calibration']['gsat-current'][t]['P'] for t in ('basic', 'advanced', 'top')},
            'by_section': bands['calibration']['gsat-current']['by_section'],
        },
        'variants': {
            'writing': {k: raw['writing']['tier_rule'][k] for k in ('id', 'basic', 'advanced', 'top')},
            'mixed_written_items': raw['mixed']['tier_rule']['written_items'],
            'mixed_multi_select_statistic': raw['mixed']['tier_rule']['multi_select_statistic'],
            'composition': raw['writing']['tier_rule']['composition_note'],
        },
    }

    evidence = {
        'band_success_matrix': band_success_matrix(bands),
        'tier_counts_current': counts,
        'distractor_pull_current': distractor_pull(item_stats, bands, CURRENT_EXAMS),
        'distractor_pull_gsat_91_115': distractor_pull(item_stats, bands, GSAT_91_115),
        'answer_letters_current': answer_letters_current(papers),
        'topics_current': topics_current(papers),
        'vocabulary_key_reuse_current': vocabulary_key_reuse(papers, forms),
        'distractor_pull_method': '單選題（不含第 49 題多選）每題取「誘答中高分組（前 33%）選答率最高者」與「低分組（後 33%）最高者」；級別取 difficulty-bands.json',
    }

    inputs = {rel(p): sha256(p) for p in files}
    for p in (BANDS_PATH, ITEM_STATS_PATH, FORMS_PATH):
        inputs[rel(p)] = sha256(p)
    # data/exams/parsed 只用到題號、答案與 tags，題本的其他欄位常被正規化工作改動，所以不記雜湊，
    # 以免與本檔無關的修改讓 --check 失敗。
    inputs['data/exams/parsed/*.json'] = f'{len(index)} 份考卷（不記雜湊）'

    spec = {
        'schema': 'gsat-generation-spec-merged/v1',
        'schema_version': SCHEMA_VERSION,
        'title': '學測英文 AI 出題規格（全 App 合併版）',
        'doc': DOC,
        'generated_by': 'tools/build_generation_spec.py',
        'built_from': {
            'inputs_sha256': inputs,
            'section_generated_on': {k: raw[k].get('generated_on') for k in SECTION_ORDER if k in raw},
            'excluded_section_keys': EXCLUDED_SECTION_KEYS,
            'note': '各大題的 sources（分析用逐題標註）留在 data/exams/generation-spec/<section>.json，本檔不併入',
        },
        'precedence': PRECEDENCE,
        'section_order': SECTION_ORDER,
        'tier_keys': {t: TIER_BAND[t] for t in TIER_KEYS},
        'tiers': TIERS,
        'tier_rule': tier_rule,
        'exam_format': exam_format(papers['gsat-115'], sections),
        'mock_exam': {
            'tier_counts_default': mock_rows,
            'tier_counts_total': mock_total,
            'official_mean_per_paper_111_115': counts['mean_per_paper'],
            'rules': [
                '題號、配分、作答方式照 115 學測（exam_format）。',
                '各大題配比照 sections.<section>.set_composition 的模擬卷欄位；預設值見 tier_counts_default。',
                '綜合測驗每篇三級各 ≥1；篇章結構最後一格放進階；閱讀恰 1 題看文選圖、主旨題放該篇第 1 題、結構題放第 4 題。',
                '中譯英用進階（每 5 份可放 1 份超越頂標）；作文用進階的圖片議題題，第二段任務與最近 5 份不重複。',
                '混合題多選用穩定基礎或進階，書寫子題進階～超越頂標；文本形式輪替雙文本、多則留言、清單＋地圖。',
                '主題配額與 SDG 規則見 common_rules.topics_and_sdgs；各題組主題不重複。',
            ],
        },
        'tier_summary': summary,
        'common_rules': COMMON_RULES,
        'pipeline': PIPELINE,
        'calibration': CALIBRATION,
        'global_checks': GLOBAL_CHECKS,
        'spec_conflicts': SPEC_CONFLICTS,
        'known_limitations': KNOWN_LIMITATIONS,
        'global_evidence': evidence,
        'checks_index': checks_index,
        'checks_counts': checks_counts(checks_index),
        'anchors_index': anchors_index,
        'validation': {
            'sections': len(sections),
            'checks': len(checks_index),
            'anchors': len(anchors_index),
            'anchor_question_refs': sum(len(a['labels']) for a in anchors_index),
            'statistical_anchors': sum(1 for a in anchors_index if a.get('statistical_anchor', True)),
            'anchors_resolved_in_parsed': True,
            'checks_fields_complete': True,
        },
        'sections': sections,
    }
    return spec, errors, index


def exam_format(paper, sections):
    """以 115 學測題本整理全卷格式（題號、題數、配分、選項數、題組數）。"""
    rows = []
    for sec in paper['sections']:
        labels = []
        n_opts = set()
        for grp in sec['groups']:
            bank = grp.get('options_bank')
            for q in grp['questions']:
                labels.append(q['label'])
                if isinstance(q.get('options'), dict):
                    n_opts.add(len(q['options']))
                elif isinstance(bank, dict):
                    n_opts.add(len(bank))
        modes = sorted({q['mode'] for grp in sec['groups'] for q in grp['questions']})
        key = {'translation': 'writing', 'composition': 'writing'}.get(sec['type'], sec['type'])
        rows.append({
            'section': sec['type'],
            'spec_section': key,
            'title': sec['title'],
            'labels': [labels[0], labels[-1]] if labels else [],
            'questions': len(labels),
            'points_total': sec['points_total'],
            'groups': len(sec['groups']),
            'options_per_question': sorted(n_opts),
            'modes': modes,
            'format_pointer': f'sections.{key}.format',
        })
    return {
        'reference_exam': paper['id'],
        'time_minutes': paper['time_minutes'],
        'full_score': paper['full_score'],
        'parts_points': [p['points'] for p in paper.get('parts', [])],
        'sections': rows,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='只比對，不寫檔；與現有檔案不同就以 1 結束')
    args = ap.parse_args()

    spec, errors, index = build()
    md_files, md_refs, md_errors = verify_markdown(index)
    errors += md_errors

    print(f'大題 {spec["validation"]["sections"]}／7；檢核 {spec["validation"]["checks"]} 條'
          f'（{spec["checks_counts"]["total"]}）；錨點 {spec["validation"]["anchors"]} 個、'
          f'{spec["validation"]["anchor_question_refs"]} 個題號')
    print(f'文件引用：{len(md_files)} 個檔案、{md_refs} 處考卷或題號引用')
    if errors:
        print(f'錯誤 {len(errors)} 項：', file=sys.stderr)
        for e in errors:
            print('  - ' + e, file=sys.stderr)
        return 1

    text = json.dumps(spec, ensure_ascii=False, indent=1) + '\n'
    if args.check:
        current = OUT_PATH.read_text(encoding='utf-8') if OUT_PATH.exists() else None
        if current != text:
            print(f'{rel(OUT_PATH)} 不是最新，請重跑 python3 tools/build_generation_spec.py', file=sys.stderr)
            return 1
        print(f'{rel(OUT_PATH)} 是最新的')
        return 0
    OUT_PATH.write_text(text, encoding='utf-8')
    print(f'已寫入 {rel(OUT_PATH)}（{len(text.encode("utf-8")):,} bytes）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
