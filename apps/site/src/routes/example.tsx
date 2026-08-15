import { Show, createSignal } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import {
  Avatar,
  Icon,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Dialog,
  Spinner,
  TextField,
  useDialogContext,
} from "@dailogues/ui";

// 组件示例页（仅本地开发）：集中展示 @dailogues/ui 共享组件的用法与交互。
// - 本地 dev 生效：非 dev 构建（生产）直接渲染 null，路由内容整体不输出
// - 示例文案为中文硬编码（开发工具页，不参与 i18n）
// - Dialog 示范：打开/关闭（触发元素→动画方向 + 焦点恢复）、purpose 三种退出方式、
//   fullscreen、isInline 预览、[data-autofocus] 自动聚焦、可访问名称接线

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
  dialogTitle: {
    margin: 0,
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightSemiBold,
  },
  dialogBody: {
    margin: `${dimensions.spacing3} 0 ${dimensions.spacing5}`,
    color: colors.onSurface,
  },
});

export default function Example() {
  // 仅本地 dev 生效：生产构建 import.meta.env.DEV=false（vite 构建期替换为字面量），
  // 页面直接返回空——/example 在生产不输出任何内容
  if (!import.meta.env.DEV) return null;

  // ---- 交互状态 ----
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [formDialogOpen, setFormDialogOpen] = createSignal(false);
  const [requiredOpen, setRequiredOpen] = createSignal(false);
  const [fullscreenOpen, setFullscreenOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const [bannerVisible, setBannerVisible] = createSignal(true);

  // Dialog 内容共用：标题 id 用 useDialogContext() 接入可访问名称（Dialog 自动回写
  // aria-labelledby）；children 在 Dialog 渲染时惰性求值，此处可读到 Provider。
  // 打开后自动聚焦 [data-autofocus] 元素（原生 input 示范——TextField 不透传该属性）
  const dialogContent = (title: string, onClose: () => void) => (
    <>
      <h3 {...stylex.props(styles.dialogTitle)} id={useDialogContext()?.titleId}>
        {title}
      </h3>
      <p {...stylex.props(styles.dialogBody)}>
        焦点圈定、Escape 关闭、遮罩点击关闭、滚动锁与焦点恢复由原生 &lt;dialog&gt; + Dialog
        组件接管。
      </p>
      <input
        data-autofocus
        placeholder="data-autofocus：打开后自动聚焦"
        style={{
          width: "100%",
          "box-sizing": "border-box",
          "margin-bottom": "16px",
          padding: "8px 12px",
          "border-radius": "8px",
          border: "1px solid #555",
          background: "#222",
          color: "#eee",
        }}
      />
      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
        <Button variant="neutral" appear="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onClose}>确定</Button>
      </div>
    </>
  );

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Title>组件示例 · Dailogues</Title>
        <h1 {...stylex.props(styles.title)}>UI 组件示例</h1>
        <p {...stylex.props(styles.intro)}>
          @dailogues/ui 共享组件示范页（仅本地开发可见）。源码：packages/ui/src/components/*。
        </p>

        {/* ---- Button ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Button</h2>
          <div {...stylex.props(styles.row)}>
            <Button>primary fill</Button>
            <Button variant="secondary" appear="outline">secondary outline</Button>
            <Button variant="brand" appear="ghost">brand ghost</Button>
            <Button variant="danger">danger</Button>
            <Button variant="neutral" appear="outline" size="sm">sm</Button>
            <Button size="lg">lg</Button>
            <Button isLoading>loading</Button>
            <Button isDisabled>disabled</Button>
          </div>
        </section>

        {/* ---- ButtonGroup ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>ButtonGroup</h2>
          <ButtonGroup label="视图切换" size="sm">
            <Button>列表</Button>
            <Button>网格</Button>
            <Button>时间线</Button>
          </ButtonGroup>
        </section>

        {/* ---- Card ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Card</h2>
          <Card>基础卡片容器：surface 底色 + 圆角。内容自由填充。</Card>
        </section>

        {/* ---- Banner ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Banner</h2>
          <Show when={bannerVisible()}>
            <Banner
              status="info"
              title="可关闭的信息横幅"
              description="关闭按钮自管理隐藏，无需外部状态。"
              isDismissable
              onDismiss={() => setBannerVisible(false)}
            />
          </Show>
          <Banner status="warning" title="警告横幅" description="container=card，可折叠 children。" />
        </section>

        {/* ---- TextField / Spinner / Avatar ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>TextField / Spinner / Avatar</h2>
          <TextField label="演示输入" value={text()} onInput={setText} placeholder="受控输入框" />
          <div {...stylex.props(styles.row)} style={{ "margin-top": "12px" }}>
            <Spinner size={20} />
            <Avatar name="演示用户" size={40} />
            <Avatar image={null} name="Dailogues" size={40} />
          </div>
        </section>

        {/* ---- Dialog ---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Dialog</h2>
          <div {...stylex.props(styles.row)}>
            <Button onClick={() => setDialogOpen(true)}>标准弹窗</Button>
            <Button variant="neutral" appear="outline" onClick={() => setFormDialogOpen(true)}>
              purpose=form（禁点遮罩）
            </Button>
            <Button variant="danger" appear="outline" onClick={() => setRequiredOpen(true)}>
              purpose=required（无退出方式）
            </Button>
            <Button variant="brand" appear="ghost" onClick={() => setFullscreenOpen(true)}>
              fullscreen
            </Button>
          </div>

          {/* 标准弹窗：Escape + 遮罩点击均可关闭；触发按钮记录动画起点并恢复焦点 */}
          <Dialog isOpen={dialogOpen()} onOpenChange={setDialogOpen}>
            {dialogContent("标准弹窗", () => setDialogOpen(false))}
          </Dialog>

          {/* form：Escape 可关，点遮罩不关 */}
          <Dialog isOpen={formDialogOpen()} onOpenChange={setFormDialogOpen} purpose="form">
            {dialogContent("purpose=form", () => setFormDialogOpen(false))}
          </Dialog>

          {/* required：Escape/遮罩全部禁用 + role=alertdialog；只能程序关闭 */}
          <Dialog isOpen={requiredOpen()} onOpenChange={setRequiredOpen} purpose="required">
            {dialogContent("purpose=required", () => setRequiredOpen(false))}
          </Dialog>

          {/* fullscreen：铺满视口（忽略 width/position/padding 尺寸约束） */}
          <Dialog
            isOpen={fullscreenOpen()}
            onOpenChange={setFullscreenOpen}
            variant="fullscreen"
          >
            {dialogContent("fullscreen", () => setFullscreenOpen(false))}
          </Dialog>
        </section>

        {/* ---- Dialog isInline（文档预览模式）---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Dialog isInline（预览模式）</h2>
          <Dialog isInline isOpen onOpenChange={() => {}}>
            {dialogContent("isInline 预览", () => {})}
          </Dialog>
        </section>

        {/* ---- 图标 Icon（按需注入内联 SVG）---- */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>图标 Icon</h2>
          <p>
            按需注入：iconify API 单图标拉取，内联 SVG（无 web component）。颜色继承 currentColor，尺寸由 width 控制。
          </p>

          {/* 尺寸 */}
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            <Icon icon="mdi:send" width={16} />
            <Icon icon="mdi:send" width={20} />
            <Icon icon="mdi:send" width={32} />
            <Icon icon="mdi:send" width={48} />
          </div>

          {/* 颜色（currentColor 继承） */}
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            <Icon icon="mdi:heart" width={24} style={{ color: "red" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "green" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "#3b82f6" }} />
          </div>

          {/* 常用图标（mdi 集合） */}
          <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "16px", padding: "12px 0" }}>
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
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            <Icon icon="mdi:alert" width={24} />
            <Icon icon="mdi-light:alert" width={24} />
          </div>

          {/* 组件内使用：按钮图标 */}
          <div style={{ display: "flex", gap: "12px", padding: "12px 0" }}>
            <Button label="保存" icon={<Icon icon="mdi:content-save" width={16} />} />
            <Button label="刷新" icon={<Icon icon="mdi:refresh" width={16} />} isIconOnly />
          </div>
        </section>
      </div>
    </main>
  );
}
