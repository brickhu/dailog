import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

const styles = stylex.create({
  field: {
    marginBottom: tokens.space4,
  },
  label: {
    display: "block",
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space1,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorBg,
    color: tokens.colorText,
    fontSize: tokens.fontSizeMd,
  },
});

export interface TextFieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: string;
  autocomplete?: string;
}

/** 带标签的输入框（两站共享）：label + 深色输入框 */
export function TextField(props: TextFieldProps) {
  return (
    <div {...stylex.props(styles.field)}>
      <label {...stylex.props(styles.label)}>{props.label}</label>
      <input
        {...stylex.props(styles.input)}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        autocomplete={props.autocomplete}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </div>
  );
}
