// 主持人结构化人设（与后端 profiles.persona / HostPersona 对齐）
// 核心是性格画像（traits）：如"风趣幽默，雷厉风行"——用户指定的风格，生成时遵循
export interface HostPersona {
  /** 节目中的称呼（优先级最高） */
  callName?: string | null;
  /** 性格/风格描述（自由文本） */
  traits?: string | null;
}

export const EMPTY_PERSONA: HostPersona = {
  callName: null,
  traits: null,
};

/** 人设是否有任何内容（生成按钮启用判断） */
export const hasPersona = (p?: HostPersona | null): boolean =>
  Boolean(p && (p.callName?.trim() || p.traits?.trim()));
