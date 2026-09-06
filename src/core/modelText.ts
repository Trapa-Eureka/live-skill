// 모델 출력 텍스트 위생(C1, DESIGN §4). 순수 함수, 외부 IO 없음. 제어문자 범위는 눈에 보이지 않으므로 반드시
// \u 이스케이프로만 쓴다(리터럴 제어문자를 소스에 넣지 않는다 — 과거 BOM 리터럴 사고와 같은 이유).

// C0 제어문자(개행 U+000A·탭 U+0009 제외)와 DEL(U+007F).
// eslint-disable-next-line no-control-regex -- 제어문자 제거가 목적이다
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/** 개행·탭을 제외한 C0 제어문자와 DEL을 제거한다 — 증류 본문처럼 파일에 그대로 쓰이는 모델 출력에 적용. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_EXCEPT_NEWLINE_TAB, "");
}

/** 한 줄 필드(제목·id) 검사용 — 제어문자(개행 포함)가 하나도 없어야 한다. */
export const SINGLE_LINE_PATTERN = /^[^\p{Cc}]+$/u;

/** 여러 줄 필드(질문·답변·인용) 검사용 — 개행·탭만 허용, 다른 제어문자는 거부. */
// eslint-disable-next-line no-control-regex -- 제어문자 검사가 목적이다
export const MULTI_LINE_PATTERN = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u;
