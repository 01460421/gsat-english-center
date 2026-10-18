/**
 * 學校與補習班常見的作文題目語料（docs/design/custom-essay.md §7.1，產品審查 P4）：自訂題目的輸入規則必須讓這些題目
 * **全部不被拒收**（提醒可以有）。題目是本站仿照常見題型自己寫的（不照抄任何真實講義或考卷），涵蓋中文題目、英文題目、
 * 看圖題、書信題、含「分鐘」「規則」「佳作」「優秀作品」「sample essays」這類容易誤擋字眼的題目、80–100 字與 250 字的要求。
 *
 * 和「Worker 題目庫的 96 題作文」那組（custom-essay.data.test.ts）分開維護：那組是真實題目，這組是學生最常貼的講義題型。
 * 規則調整後誤擋了這裡任何一題，custom-essay.test.ts 就會失敗；要嘛修樣式，要嘛（題目確實不該送出時）把它移出這份清單並寫明理由。
 */

export interface SchoolPromptFixture {
  /** 題目文字（學生貼進「作文題目」欄的內容）。 */
  text: string;
  /** 圖片或圖表的文字描述（學生自己寫的）。 */
  figure_text?: string;
  /** 這一題要測的重點（給維護的人看）。 */
  note: string;
}

export const SCHOOL_PROMPTS: readonly SchoolPromptFixture[] = [
  // ── 產品審查 P4 列出的 7 句（第 1 版的樣式全部誤擋）──
  { note: 'P4：給自己 30 分鐘', text: '提示：如果每天給自己 30 分鐘做一件喜歡的事，你會做什麼？請寫一篇英文作文，說明你的選擇與原因。' },
  { note: 'P4：給你 10 分鐘', text: '如果老師願意給你 10 分鐘自由發表，你想跟全班分享什麼？請寫一篇英文作文，文分兩段。' },
  { note: 'P4：忘記遵守規則', text: '請描述一次你忘記遵守規則而學到教訓的經驗，並說明這件事如何改變你的想法。' },
  { note: 'P4：作品獲得佳作', text: '你參加英文作文比賽，作品獲得佳作，請寫一封英文信感謝指導你的老師。' },
  { note: 'P4：優秀作品', text: '學校即將展出本學期的優秀作品，請寫一篇英文作文，介紹一件你最想推薦給同學欣賞的作品。' },
  { note: 'P4：ignore the rules', text: 'Have you ever decided to ignore the rules to help a friend? Write about what happened and whether you would make the same choice again.' },
  { note: 'P4：sample essays', text: 'Your class is making a booklet of sample essays for junior students. Write a short introduction for the booklet explaining why reading good writing helps.' },

  // ── 中文題目（說明＋要寫的內容）──
  { note: '兩段、各段重點', text: '提示：你的學校即將舉辦「無手機日」，當天所有同學都不能使用手機。請寫一篇英文作文，文分兩段，第一段說明你對這個活動的看法，第二段描述你那天會怎麼安排時間。' },
  { note: '一段經驗（「一段」不是段數）', text: '提示：每個人都有一段難忘的旅行經驗。請寫一篇英文作文，第一段描述你最難忘的一次旅行，第二段說明這次旅行讓你學到什麼。' },
  { note: '至少 120 字', text: '提示：許多高中生放學後會去補習。請寫一篇英文作文，說明你對補習的看法，並舉例支持你的論點。文長至少 120 個單詞。' },
  { note: '120–150 字＋分鐘', text: '提示：請用 40 分鐘寫一篇英文作文，描述一位對你影響深遠的人，並說明他或她如何改變了你。（字數：120–150 字）' },
  { note: '校規、規則', text: '提示：有些人認為學生應該遵守所有校規，也有人覺得某些規則已經過時。請寫一篇英文作文，第一段說明一條你認為應該修改的校規，第二段提出你的修改建議。' },
  { note: '80–100 字', text: '提示：近年來外送平台越來越普及。請寫一篇英文作文，第一段說明外送平台為生活帶來哪些便利，第二段討論它可能造成的問題。字數 80–100 字。' },
  { note: '至少 250 字', text: '提示：請以「My Dream Job」為題，寫一篇至少 250 字的英文作文，說明你未來想從事的工作，以及你打算如何達成這個目標。' },
  { note: '日記', text: '提示：請寫一則英文日記，記錄你第一次自己煮飯的經驗。內容須包括你煮了什麼、過程中遇到的困難，以及你的感想。' },
  { note: '環保、文分兩段', text: '提示：環保是現代人共同的責任。請寫一篇英文作文，說明你在日常生活中做過哪些環保行動，並鼓勵同學一起參與。文分兩段。' },
  { note: '故事、120 至 150 個單詞', text: '請根據以下情境寫一篇英文故事：一隻流浪狗某天跟著你回家。故事須包含開始、經過與結局，約 120 至 150 個單詞。' },
  { note: '超能力', text: '提示：如果你可以擁有一種超能力，你會選擇什麼？請寫一篇英文作文，說明你的選擇與原因，以及你會如何使用這個能力。' },
  { note: '中英混合的題目', text: '提示：很多同學在考試前一晚熬夜念書。請以 Is Staying Up Late Worth It? 為題，寫一篇英文作文，提出你的立場並說明理由。' },
  { note: '100 字以上', text: '英文寫作練習：請寫一篇短文介紹你最喜歡的一道台灣小吃，包括它的味道、做法和你喜歡它的原因。字數 100 字以上。' },
  { note: '本題 20 分、作答時間（不是配分說明）', text: '提示：學校打算取消午睡時間，改成自由活動。請寫一篇英文作文，第一段說明你支持或反對的立場，第二段提出兩個理由。（本題 20 分，作答時間 40 分鐘）' },
  { note: '老師在課堂上（不是表頭）', text: '下列是你的英文老師在課堂上提出的問題：What makes a good friend? 請寫一篇英文作文回答這個問題，並以你自己的經驗舉例。' },
  { note: '內容、組織、文法（沒有分數）', text: '提示：請描述一個你曾經犯過的錯誤，以及你從中學到的教訓。請注意：內容須切題，組織要清楚，文法與用字要正確。' },
  { note: '名言', text: '提示：有人說「失敗為成功之母」。請寫一篇英文作文，舉出一個你自己或他人的例子，說明失敗如何帶來成長。' },
  { note: '補習班講義的單元名稱', text: '補習班講義 Unit 5 寫作練習。主題：The Best Gift I Have Ever Received。請描述這份禮物、送禮的人，以及它對你的意義。' },
  { note: '社論', text: '你是校刊社的編輯，正在規劃下一期的主題「青春與夢想」。請寫一篇英文社論，鼓勵同學勇敢追求自己的夢想。' },
  { note: '150 字以內', text: '提示：每年寒暑假，許多學生會去打工。請寫一篇英文作文，第一段說明打工的好處，第二段說明可能的壞處，並提出你的建議。字數 150 字以內。' },
  { note: '請告訴我（聊天式的中文）', text: '請告訴我你最喜歡的節日，以及你和家人通常怎麼慶祝。請寫一篇英文作文，文分兩段。' },
  { note: '可以用中文構思', text: '請寫一篇英文作文，談談你最想學會的一項技能（例如游泳、彈吉他、寫程式），並說明你會如何開始學習。可以用中文構思，但作文必須用英文寫。' },
  { note: '期中考、至少 120 字', text: '期中考作文：A Lesson I Learned from Sports. 請分兩段，第一段描述一次運動經驗，第二段說明你學到的事。至少 120 字。' },
  { note: '優秀作品集', text: '提示：老師在課堂上發下一份優秀作品集，請你閱讀後寫一篇英文作文，說明你最欣賞的一篇作品及原因。' },

  // ── 角色扮演、書信、電子郵件 ──
  { note: '角色扮演：班長寫信', text: '假如你是班長，班上同學對畢業旅行的地點意見分歧。請寫一封信給導師，說明大家的意見，並提出你的建議。' },
  { note: '電子郵件給外國朋友', text: '你的外國朋友 Tom 下個月要來台灣玩三天。請寫一封英文電子郵件給他，建議他參觀的地方，並說明理由。' },
  { note: '客服信', text: '情境：你在網路上買了一雙鞋，收到後發現尺寸不對。請寫一封英文電子郵件給客服，說明問題並提出你希望的處理方式。' },
  { note: '歡迎信', text: '你的學校將舉辦國際交流週，會有日本學生來訪。請寫一封英文歡迎信，介紹學校的特色以及交流週的活動安排。' },

  // ── 英文題目 ──
  { note: '英文書信、about 150 words', text: 'Write a letter to your pen pal in Canada about the most popular festival in Taiwan. Describe how people celebrate it and why you like it. Your letter should be about 150 words.' },
  { note: '英文角色扮演', text: 'Suppose you are a volunteer at a local library. Write a short article for the school newspaper inviting classmates to join the reading program. Explain what volunteers do and why it is meaningful.' },
  { note: '寫給校長的 email', text: 'Imagine that your class is going to plant a garden on the school rooftop. Write an email to the principal explaining the plan and asking for permission. Mention at least two benefits of the garden.' },
  { note: 'Topic 標籤', text: 'Topic: Online Learning vs. Classroom Learning. Compare the two ways of learning and explain which one you prefer. Give at least two reasons and one example from your own experience.' },
  { note: '段考題、no more than 180 words', text: '段考作文題：Describe a challenge you faced this semester and how you dealt with it. Write in two paragraphs, no more than 180 words.' },
  { note: '感謝卡', text: 'Write a thank-you card to a teacher who helped you during your first year of senior high school. Mention one specific thing the teacher did and how it helped you.' },
  { note: 'opinion paragraph', text: 'Write an opinion paragraph: Should students be allowed to use smartphones during lunch break? State your opinion and support it with two reasons.' },
  { note: 'Prompt 標籤、班級旅行', text: 'Prompt: You are planning a class trip to Hualien. Write a message to your classmates describing the schedule for the first day and reminding them what to bring.' },
  { note: 'Can you imagine（不是要 AI 寫）', text: 'Can you imagine a day without electricity? Write an essay describing how your life would change and what you would do to pass the time.' },

  // ── 看圖、圖表題（圖片描述是學生自己寫的）──
  {
    note: '連環圖',
    text: '看圖作文：下面三幅連環圖描述一位學生某天早上發生的事。請仔細觀察圖片，寫出一篇涵蓋每張圖內容的故事，並為故事寫一個合理的結局。',
    figure_text: '圖一：男孩睡過頭，鬧鐘顯示七點半。\n圖二：他衝出家門，忘了帶便當。\n圖三：媽媽騎機車追到公車站，把便當交給他。',
  },
  {
    note: '表格（某高中學生，不是表頭）',
    text: '下表是某高中學生每週使用社群媒體的時數調查結果。請寫一篇英文作文，第一段描述表格內容，第二段說明你對這個結果的看法。',
    figure_text: '表格：每週 0–5 小時 18%；6–10 小時 35%；11–20 小時 30%；20 小時以上 17%。',
  },
  {
    note: '公車上的圖',
    text: '看圖作文：圖片中，一位老太太在公車上站著，旁邊的年輕人低頭滑手機。請描述圖片內容，並說明你對這個現象的看法。',
    figure_text: '公車上人很多，老太太提著菜籃站著，座位上的年輕人戴著耳機看手機。',
  },
  {
    note: '英文的四格圖',
    text: 'Picture writing: Look at the four pictures and write a story about what happened to the girl and her cat. Give your story a title.',
    figure_text: '1. A girl finds a kitten in the rain.\n2. She brings it home, but her mother looks unhappy.\n3. The kitten catches a mouse in the kitchen.\n4. The mother smiles and hugs the kitten.',
  },
  {
    note: '折線圖',
    text: '提示：圖表顯示台灣近十年來外食人口的變化。請描述圖表的趨勢，並說明造成這個變化可能的原因。',
    figure_text: '折線圖：外食比例從 2015 年的 45% 上升到 2024 年的 62%，其中 2020 年短暫下降。',
  },

  // ── 審查 ux-4：引號裡的對話、描述別人幫忙、「請參考範例」、尖括號標題與圖號（cp1 全部誤擋）──
  { note: 'ux-4：引號裡的「幫我寫」', text: '你的朋友傳訊息說：『可以幫我寫生日卡片嗎？』請寫一篇英文作文，描述你如何回應。' },
  { note: 'ux-4：描述幫我完成夢想的人', text: '請描述一位曾經幫我完成夢想的人，並說明他對你的影響。' },
  { note: 'ux-4：老師給我修改作文的經驗', text: '請描述一次老師給我修改作文的經驗，並說明你從中學到什麼。' },
  { note: 'ux-4：參考範例的書信格式', text: '請參考範例的書信格式，寫一封英文信給你的筆友，介紹你的學校。' },
  { note: 'ux-4：請參考範例', text: '請參考範例，寫一封英文邀請函，邀請同學參加班上的聖誕晚會。' },
  { note: 'ux-4：<Picture 1>', text: 'Look at <Picture 1> and <Picture 2> and write a story about what happened.' },
  { note: 'ux-4：全形尖括號標題', text: '請以＜My Favorite Season＞為題，寫一篇英文作文，說明你最喜歡的季節與原因。' },
  { note: 'ux-4：巢狀引號', text: '學弟請你：『可以幫我改寫自傳嗎？』請寫一封英文信回覆他，告訴他你的建議。' },
  { note: 'ux-4：英文引號裡的 write … for me', text: 'Your friend asks, "Could you write a story for me?" Write a reply explaining why you will help him in a different way.' },
  { note: 'ux-4：英文引號裡的 Write it for me', text: 'Your little brother says, "Write it for me!" when he has homework. Write about how you would respond.' },
];
