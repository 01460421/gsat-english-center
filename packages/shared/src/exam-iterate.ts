/**
 * 依序走訪一份考卷的所有小題（網站的練習模式逐題作答、Worker 找學習助手要問的題號與所屬題組共用；
 * docs/design/learning-assistant.md §4.5.2）。
 *
 * 從 apps/web/src/data/exams.ts 搬來，行為不變；web 改成從這裡轉匯出。
 * 泛型：只要求 { sections: { groups: { questions }[] }[] } 的形狀，web 的 Exam（前端的資料檔型別）、
 * 共用的 Exam（exam.ts）與本站自組模擬考組出的考卷都可以直接傳進來，回傳的大題、題組、小題保留呼叫端的型別。
 */

/** iterateQuestions 收的考卷形狀。 */
export interface IterableExam {
  sections: ReadonlyArray<{ groups: ReadonlyArray<{ questions: readonly unknown[] }> }>;
}

type SectionOf<E extends IterableExam> = E['sections'][number];
type GroupOf<E extends IterableExam> = SectionOf<E>['groups'][number];
type QuestionOf<E extends IterableExam> = GroupOf<E>['questions'][number];

/** 依序列出考卷的所有小題（含所屬大題與題組），練習模式逐題作答時用。 */
export function* iterateQuestions<E extends IterableExam>(exam: E): Generator<{ section: SectionOf<E>; group: GroupOf<E>; question: QuestionOf<E> }> {
  for (const section of exam.sections as ReadonlyArray<SectionOf<E>>) {
    for (const group of section.groups as ReadonlyArray<GroupOf<E>>) {
      for (const question of group.questions as ReadonlyArray<QuestionOf<E>>) yield { section, group, question };
    }
  }
}
