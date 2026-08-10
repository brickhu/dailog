// 主持人结构化人设（与后端 profiles.persona / HostPersona 对齐）
export interface HostPersona {
  /** 节目中的称呼（优先级最高） */
  callName?: string | null;
  gender?: string | null;
  profession?: string | null;
  age?: string | null;
  /** 爱好（多项） */
  hobbies?: string[] | null;
  /** 其他自由描述（兜底） */
  extra?: string | null;
}

export const EMPTY_PERSONA: HostPersona = {
  callName: null,
  gender: null,
  profession: null,
  age: null,
  hobbies: null,
  extra: null,
};

/** 表单爱好输入：数组 <-> 逗号分隔文本 */
export const hobbiesToText = (h?: string[] | null): string => (h ?? []).join("、");
export const textToHobbies = (text: string): string[] | null => {
  const list = text.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  return list.length > 0 ? list : null;
};

/** 人设是否有任何内容（生成按钮启用判断） */
export const hasPersona = (p?: HostPersona | null): boolean =>
  Boolean(p && (p.callName?.trim() || p.gender?.trim() || p.profession?.trim() || p.age?.trim() || (p.hobbies?.length ?? 0) > 0 || p.extra?.trim()));
