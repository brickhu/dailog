import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import Importer, { type ImportedDialogue } from "../components/importer";

// /import（根路径 = 导入页）：分享链接采集——业务逻辑全部在 Importer 组件
// （预检/采集/预览/生成脚本）；本页只负责：创建容器后跳编辑页。
// 是否登录/开通频道由 app 的 auth provider 负责（未登录 → 登录锁定；403 → 频道引导提示）

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  content: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
});

export default function CollectPage() {
  const navigate = useNavigate();

  /** 创作容器已创建：跳编辑页（润色脚本 → 生成节目） */
  const onGenerated = (_polishId: string, _dialogue: ImportedDialogue) => {
    navigate(`/polish/${_polishId}`);
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Importer onGenerated={onGenerated} />
      </div>
    </div>
  );
}
