// 投稿区选择器（导入弹框 + /submit 共用）：中文区 / English 区。
// 规则：一投稿 = 一语言区 = 一期节目；投稿人可对同一篇对话分别投到不同区，**已投过的区不可重复投递**。
import { For } from "solid-js";
import { Button } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { dimensions } from "@dailogues/ui/theme.stylex";

export interface ZoneOption {
  /** 投稿区码（= 目标语言，如 zh/en） */
  zone: string;
  /** 展示名（走 i18n 的 lang.<code>） */
  label: string;
  /** 该区已投稿 → 不可再投（disabled） */
  taken: boolean;
}

const styles = stylex.create({
  row: {
    display: "flex",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
});

export function ZonePicker(props: {
  options: ZoneOption[];
  value: string;
  /** 「已投稿」标记文案（i18n） */
  takenLabel: string;
  disabled?: boolean;
  onChange: (zone: string) => void;
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <For each={props.options}>
        {(o) => (
          <Button
            variant={props.value === o.zone ? "brand" : "neutral"}
            appear={props.value === o.zone ? "fill" : "outline"}
            disabled={o.taken || props.disabled}
            onClick={() => props.onChange(o.zone)}
          >
            {o.taken ? `${o.label} · ${props.takenLabel}` : o.label}
          </Button>
        )}
      </For>
    </div>
  );
}
