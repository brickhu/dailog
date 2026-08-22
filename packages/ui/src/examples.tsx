import { createSignal } from "solid-js";
import { Button } from "./components/button";
import { ButtonGroup } from "./components/button-group";
import { Badge } from "./components/badge";
import { TextInput } from "./components/text-input";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "./theme.stylex";
import { Icon, addIcon } from './components/icon';

// 自定义图标注册（addIcon）：无需访问 iconify API，注册后 <Icon icon="..." /> 直接渲染
addIcon("demo:heart", {
  body: '<path fill="currentColor" d="M12 21s-6.7-4.3-9.3-8.1C.8 10.2 2 6.5 5.5 6c2-.3 3.9.8 4.7 2.4.1.2.5.2.6 0C10.6 6.8 12.5 5.7 14.5 6c3.5.5 4.7 4.2 2.8 6.9C18.7 16.7 12 21 12 21z"/>',
  width: 24,
  height: 24,
});
addIcon("demo:raw", '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>');

export default function Examples() {
  // TextInput 演示用受控状态
  const [smVal, setSmVal] = createSignal("");
  const [mdVal, setMdVal] = createSignal("");
  const [lgVal, setLgVal] = createSignal("");
  const [nameVal, setNameVal] = createSignal("");
  const [pwdVal, setPwdVal] = createSignal("");
  const [urlVal, setUrlVal] = createSignal("");
  const [brandVal, setBrandVal] = createSignal("");
  const [searchVal, setSearchVal] = createSignal("");

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
        {/* Banner 状态横幅（组件特性见 banner.md）：
            注：Solid 1.9 hydration 下部分 Banner 特性组合（isDismissable/endContent/
            defaultIsExpanded 等与相邻 Banner 共存）会触发 Hydration Mismatch（dev-only
            展示页问题，站点页面无 Banner 不受影响），示例暂不在 example 页展示 */}
        {/* Badge 徽章（复刻 Astryx Badge，组件特性见 badge.md） */}
        <div style={{ padding: "16px 0" }}>
          <h2>徽章 Badge</h2>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap", padding: "12px 0" }}>
            <Badge label="Badge" />
            <Badge variant="info" label="Info" />
            <Badge variant="success" label="Active" />
            <Badge variant="warning" label="Action Required" />
            <Badge variant="error" label="Failed" />
            <Badge variant="success" label="Verified" icon={<Icon icon="mdi:check" width={14} height={14} />} />
            <Badge variant="neutral" label="Engineering" />
          </div>
        </div>
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
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "12px 0" }}>
            {/* 自定义图标（addIcon 注册，body 方式 + 完整 SVG 字符串方式） */}
            <Icon icon="demo:heart" width={24} style={{ color: "red" }} />
            <Icon icon="demo:heart" width={32} style={{ color: "green" }} />
            <Icon icon="demo:raw" width={24} />
          </div>
        </div>
        {/* 文本输入框 TextInput（复刻 Astryx TextInput，特性见 text-input.md） */}
        <div style={{ padding: "16px 0" }}>
          <h2>文本输入框 TextInput</h2>
          {/* 输入框 + 按钮同行：同尺寸 md（32px 高 / 16px 字 / radiusMd），底部对齐 */}
          <div style={{ display: "flex", "align-items": "flex-end", gap: "12px", "flex-wrap": "wrap", padding: "12px 0" }}>
            <TextInput
              label="搜索（与右侧按钮同尺寸 md）"
              placeholder="输入关键词"
              width={300}
              value={searchVal()}
              onChange={setSearchVal}
            />
            <Button label="搜索" />
            <Button label="搜索" variant="brand" />
          </div>
          {/* 三种尺寸 */}
          <div style={{ display: "flex", "align-items": "flex-end", gap: "16px", "flex-wrap": "wrap", padding: "12px 0" }}>
            <TextInput label="小号 sm" size="sm" placeholder="24px 高 · 与 Button sm 一致" value={smVal()} onChange={setSmVal} />
            <TextInput label="中号 md（默认）" size="md" placeholder="32px 高 · 与 Button md 一致" value={mdVal()} onChange={setMdVal} />
            <TextInput label="大号 lg" size="lg" placeholder="40px 高 · 与 Button lg 一致" value={lgVal()} onChange={setLgVal} />
          </div>
          {/* 常用形态 */}
          <div style={{ display: "flex", "align-items": "flex-start", gap: "16px", "flex-wrap": "wrap", padding: "12px 0" }}>
            <TextInput label="姓名" value={nameVal()} onChange={setNameVal} placeholder="请输入姓名" isRequired />
            <TextInput label="密码" type="password" value={pwdVal()} onChange={setPwdVal} placeholder="••••••••" hasClear />
            <TextInput
              label="官网"
              type="url"
              value={urlVal()}
              onChange={setUrlVal}
              placeholder="https://example.com"
              status={urlVal().length > 0 && !urlVal().startsWith("http") ? { type: "error", message: "需以 http(s):// 开头" } : undefined}
            />
            <TextInput label="禁用（含原因 tooltip）" value="只读示例" isDisabled disabledMessage="需要编辑角色才能修改" />
          </div>
          {/* 颜色变量定制 */}
          <div style={{ display: "flex", "align-items": "flex-start", gap: "16px", "flex-wrap": "wrap", padding: "12px 0" }}>
            <TextInput
              label="colorVars 定制"
              value={brandVal()}
              onChange={setBrandVal}
              placeholder="蓝底蓝边 + 蓝色聚焦"
              colorVars={{ "--ti-bg": "#f0f7ff", "--ti-border": "#3b82f6", "--ti-text": "#1e40af", "--ti-focus-bg": "#e0edff" }}
            />
            <TextInput label="默认配色（对照）" value={""} onChange={() => {}} placeholder="默认 surface 配色" />
          </div>
        </div>
    </div>
  );
}
