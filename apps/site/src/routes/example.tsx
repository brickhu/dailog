// 组件示例页（仅本地开发）：展示 @dailogues/ui 常用组件 + 图标 Icon 用法。
// 精简版：只保留基础展示（Button/Card/Icon）——复杂组件（Dialog/Banner 等）
// 与 Solid 1.9 hydration 存在已知兼容问题（见 docs/developer-guide.md 第 7 节），
// 不再在示例页集中展示，避免打开即报错。
import { createSignal } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, Card, Icon } from "@dailogues/ui";

// 仅本地 dev 生效：生产构建 import.meta.env.DEV=false（vite 构建期替换为字面量），
// 页面直接返回空——/example 在生产不输出任何内容
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  intro: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing8,
  },
  section: {
    marginBottom: dimensions.spacing8,
  },
  sectionTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightSemiBold,
    marginBottom: dimensions.spacing4,
  },
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: dimensions.spacing3,
  },
  iconRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    padding: "12px 0",
  },
});

export default function Example() {
  if (!import.meta.env.DEV) return null;

  const [count, setCount] = createSignal(0);

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Title>组件示例 · Dailogues</Title>
        <h1 {...stylex.props(styles.title)}>UI 组件示例</h1>
        <p {...stylex.props(styles.intro)}>
          @dailogues/ui 共享组件 + 图标 Icon 用法（仅本地开发可见）。
        </p>

        {/* ---- Button ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Button</h2>
          <div {...stylex.props(styles.row)}>
            <Button onClick={() => setCount(count() + 1)}>点击 {count()}</Button>
            <Button appear="outline">次要</Button>
            <Button variant="success">成功</Button>
            <Button variant="danger">危险</Button>
            <Button label="仅图标" icon={<Icon icon="mdi:refresh" width={16} />} isIconOnly />
            <Button label="带图标" icon={<Icon icon="mdi:content-save" width={16} />}>保存</Button>
          </div>
        </section>

        {/* ---- Card ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Card</h2>
          <Card>
            <p>内容自由填充。surface 底色 + 圆角。</p>
          </Card>
        </section>

        {/* ---- 图标 Icon（按需注入内联 SVG）---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>图标 Icon</h2>
          <p {...stylex.props(styles.intro)}>
            通用 Icon 组件：iconify 图标名（mdi:xxx），按需注入内联 SVG，颜色继承 currentColor，尺寸由 width 控制。
          </p>

          {/* 尺寸 */}
          <div {...stylex.props(styles.iconRow)}>
            <Icon icon="mdi:send" width={16} />
            <Icon icon="mdi:send" width={20} />
            <Icon icon="mdi:send" width={32} />
            <Icon icon="mdi:send" width={48} />
          </div>

          {/* 颜色（currentColor 继承） */}
          <div {...stylex.props(styles.iconRow)}>
            <Icon icon="mdi:heart" width={24} style={{ color: "red" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "green" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "#3b82f6" }} />
          </div>

          {/* 常用图标（mdi 集合） */}
          <div {...stylex.props(styles.iconRow)}>
            <Icon icon="mdi:home" width={24} />
            <Icon icon="mdi:close" width={24} />
            <Icon icon="mdi:check" width={24} />
            <Icon icon="mdi:alert" width={24} />
            <Icon icon="mdi:chevron-down" width={24} />
            <Icon icon="mdi:information-outline" width={24} />
            <Icon icon="mdi:microphone" width={24} />
            <Icon icon="mdi:play" width={24} />
          </div>

          {/* 集合：mdi（常规）与 mdi-light（细线变体） */}
          <div {...stylex.props(styles.iconRow)}>
            <Icon icon="mdi:alert" width={24} />
            <Icon icon="mdi-light:alert" width={24} />
          </div>
        </section>
      </div>
    </main>
  );
}
