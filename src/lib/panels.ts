// 화면에 동시에 뜨는 패널끼리 자리를 양보하기 위한 신호.
// 어디서나 여는 AI 패널이 열리면 화면의 카드 패널(FRTU 요약·제어판)은 닫히고,
// 카드 패널이 열리면 AI 패널은 접힌다. 한 번에 하나만 보이게 한다.

/** AI 도우미 패널이 열림 */
export const ASSISTANT_OPEN_EVENT = 'gw:assistant-open'
/** 화면의 카드 패널이 열림 */
export const PANEL_OPEN_EVENT = 'gw:panel-open'

export const announcePanelOpen = () => window.dispatchEvent(new Event(PANEL_OPEN_EVENT))
