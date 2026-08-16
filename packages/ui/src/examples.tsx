import { Button } from "./components/button";
import { ButtonGroup } from "./components/button-group";
import { Banner } from "./components/banner";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "./theme.stylex";
import { Icon } from './components/icon';

export default function Examples() {
  return (
    <div {...stylex.props(layouts.containerFull)}>

        <ButtonGroup label="文本操作">
  <Button label="复制" />
  <Button label="剪切" />
  <Button label="粘贴" />
</ButtonGroup>

        // 基础（默认 primary + fill + md）
        <Button label="保存" />

        // 语义色 × 外观
        <Button label="取消" appear="ghost" />
        <Button label="加入购物车" variant="secondary"  />
        <Button label="次要操作" variant="neutral" />

        // 尺寸与圆角
        <Button label="小" size="sm" />
        <Button label="大号圆角" size="xl" round="lg" />

        // 异步动作：自动 loading + 防重复点击
        <Button label="发布" clickAction={async () => {console.log("发布");}} />

        // 显式加载态
        <Button label="提交" isLoading={true} />

        // 可打断动作（如切换开关，允许重复触发）
        <Button label="发送" isInterruptible clickAction={()=>{console.log("发送");}} />

        // 图标按钮（label 作为无障碍名）
        <Button label="刷新" icon={<Icon icon="mdi-light:alert" />} isIconOnly />
        {/* <Button label="通知" icon={<BellIcon />} endContent={<span>3</span>} /> */}
        {/* <RefreshIcon /> */}

        // 悬浮提示（hover / Tab 聚焦显示）
        <Button label="删除" tooltip="删除后不可恢复" />

        // 链接形态（禁用时自动回落为 button）
        <Button label="查看文档" href="/docs" target="_blank" />

        // 整行撑满
        <Button label="确认入库" block />
        <Button label="确认入库" width="100%" />

        <Button label="删除" variant="danger" />                    // 实心红
<Button label="注意" variant="warning" appear="ghost" />    // 透明黄字
<Button label="完成" variant="success" appear="outline" />  // 绿描边

        // Banner 状态横幅（复刻 Astryx Banner）
        <Banner status="info" title="A new software update is available." />
        <Banner status="success" title="Your changes have been saved." />
        <Banner
          status="warning"
          title="Your trial expires in 3 days."
          description="Upgrade to keep access to all features."
        />
        <Banner
          status="error"
          title="Payment failed"
          description="Update your billing information to continue."
          isDismissable
          onDismiss={() => console.log("banner dismissed")}
        />

        // 操作按钮 + 折叠内容（disclosure）
        <Banner
          status="warning"
          title="Configuration changes detected"
          description="Review the changes before they take effect."
          endContent={<Button label="Review" appear="fill" size="sm" />}
          isDismissable
        >
          <ul>
            <li>Authentication method updated</li>
            <li>Rate limits modified</li>
          </ul>
        </Banner>

        // 初始展开 + 页面级横幅 + 悬浮阴影
        <Banner status="warning" title="Trial ends soon" defaultIsExpanded>
          <p>Details here...</p>
        </Banner>
        <Banner status="success" title="Changes saved" container="section" elevation="low" />

        {/* 图标 Icon：按需注入（iconify API 单图标拉取，内联 SVG） */}
        <div style={{ padding: "16px 0" }}>
          <h2>图标 Icon</h2>
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            <Icon icon="mdi:send" width={16} />
            <Icon icon="mdi:send" width={20} />
            <Icon icon="mdi:send" width={32} />
            <Icon icon="mdi:send" width={48} />
          </div>
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            <Icon icon="mdi:heart" width={24} style={{ color: "red" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "green" }} />
            <Icon icon="mdi:heart" width={24} style={{ color: "#3b82f6" }} />
          </div>
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
        </div>
    </div>
  );
}
