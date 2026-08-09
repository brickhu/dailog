import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "../theme.stylex";

const styles = stylex.create({
  field: {
    marginBottom: dimensions.spacing4,
  },
  label: {
    display: "block",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing1,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
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
