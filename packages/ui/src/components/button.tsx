import * as stylex from "@stylexjs/stylex";
import { type JSX } from "solid-js";
import { tokens } from "../theme.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    fontSize: tokens.fontSizeMd,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    border: "none",
    boxSizing: "border-box",
  },
  primary: {
    background: tokens.colorPrimary,
    color: "#fff",
    ":hover": { background: tokens.colorPrimaryHover },
  },
  ghost: {
    background: "transparent",
    color: tokens.colorText,
    border: `1px solid ${tokens.colorBorder}`,
    ":hover": { background: tokens.colorSurfaceHover },
  },
  block: { width: "100%" },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
});

export interface ButtonProps {
  variant?: "primary" | "ghost";
  block?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: JSX.Element;
}

/** 基础按钮（两站共享）：primary 实心 / ghost 描边；block 撑满宽度 */
export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      {...stylex.props(
        styles.base,
        props.variant === "ghost" ? styles.ghost : styles.primary,
        props.block && styles.block,
        props.disabled && styles.disabled,
      )}
    >
      {props.children}
    </button>
  );
}
