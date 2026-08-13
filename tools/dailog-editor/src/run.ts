// 编辑本地 Agent CLI（本质版）：登录/状态/列表/详情/下载采样/TTS/合成/封面/发布/拒审
// 用法（根目录）——环境是**会话级选择**，每次命令显式指定：
//   pnpm editor --env <环境名> <cmd> ...       环境清单见 .dailog-editor/envs.json
//   pnpm editor --api-base <url> <cmd> ...     临时直连指定地址
//   DAILOG_ENV=<环境名> pnpm editor <cmd> ...  环境变量方式
//
//   pnpm editor login [--force] [--logout]     配对码登录（浏览器授权 → 粘贴配对码）
//   pnpm editor auth-status                    当前环境授权状态（有效/无效/未登录）
//   pnpm editor list                           待审队列
//   pnpm editor overview                       工作台概要（环境/编辑/三类待办计数）
//   pnpm editor batch [--limit N]              批量提取 + 分组展示（已处理跳过）
//   pnpm editor batch-reject --ids <id1,id2> --reason "..."   批量拒审（通知+状态）
//   pnpm editor batch-scripts [--limit N]    脚本批次汇总（生成/质量不过关/待生成）
//   pnpm editor produce --ids <id1,id2> [--language zh] [--guest claude]
//                                               制作流水线（tts→merge→cover，两个确认点）
//   pnpm editor detail <submissionId>          投稿详情（URL/投稿人/采样 transcript）
//   pnpm editor fetch <submissionId>           采集 + 内容解码（拉取 URL → page.html/page.txt/dialogue.json）
//   pnpm editor rule-test <submissionId> --user-selector "..." --assistant-selector "..." [--save]
//                                               候选解码规则验证（草稿 page.html）→ 跑通入库 .dailog-editor/rules.json
//   pnpm editor console-script <submissionId>    生成浏览器控制台脚本（反爬兜底：用户浏览器提取对话到剪贴板）
//   pnpm editor paste <submissionId>             粘贴控制台输出的 JSON → 校验入库 dialogue.json
//   pnpm editor guests                         查看嘉宾列表 + 声线就绪状态
//   pnpm editor guest-voice <guestId> --audio f.mp3 [--language zh] [--transcript "..."]
//                                               上传嘉宾声线到服务端（guest_voice_samples）
//   pnpm editor guest-set <guestId> --name "..." [--intro "..."]
//                                               更新嘉宾称呼/简介（服务端 guests 表）
//   pnpm editor progress <submissionId>          进度查看（中断恢复断点）
//   pnpm editor script-preview <submissionId>    脚本预览（人工确认门：确认后进 tts）
//   pnpm editor tts <submissionId> --script <script.json> [--language zh|en]
//                                              逐段合成语音（host 采样克隆 / guest 品牌声线资源文件）
//   pnpm editor merge <submissionId> [--language zh|en] [--intro f.mp3] [--outro f.mp3]
//                                               ffmpeg 拼接（intro/outro 按语言匹配，fallback 英文）→ final.mp3
//   pnpm editor cover <submissionId> "<关键词>" [--out cover.jpg]
//                                               Pexels 搜索封面下载到草稿目录
//   pnpm editor publish <submissionId> --title "..." [--audio final.mp3] [--cover c.jpg]
//                                               [--description ...] [--tags a,b] [--language zh] [--guest claude]
//   pnpm editor reject <submissionId> --reason "..."
import { loadConfig } from "./lib.js";

// 全局参数（环境选择）在分发前剥离，避免混入子命令参数；命令名 = 第一个非全局参数
const GLOBAL_FLAGS = new Set(["--env", "--api-base"]);

const rawArgs = process.argv.slice(2);
const globalArgs: string[] = [];
const rest: string[] = [];
let cmd: string | undefined;
let i = 0;
while (i < rawArgs.length) {
  const arg = rawArgs[i];
  if (GLOBAL_FLAGS.has(arg) && rawArgs[i + 1]) {
    globalArgs.push(arg, rawArgs[i + 1]);
    i += 2;
    continue;
  }
  if (cmd === undefined) {
    cmd = arg;
  } else {
    rest.push(arg);
  }
  i++;
}
const args = rest;

async function main() {
  const config = loadConfig(globalArgs);
  switch (cmd) {
    case "login": {
      const { login } = await import("./login.js");
      await login(config, args);
      break;
    }
    case "auth-status": {
      const { authStatus } = await import("./auth-status.js");
      await authStatus(config, args);
      break;
    }
    case "list": {
      const { list } = await import("./list.js");
      await list(config, args);
      break;
    }
    case "overview": {
      const { overview } = await import("./overview.js");
      await overview(config, args);
      break;
    }
    case "batch": {
      const { batch } = await import("./batch.js");
      await batch(config, args);
      break;
    }
    case "batch-reject": {
      const { batchReject } = await import("./batch-reject.js");
      await batchReject(config, args);
      break;
    }
    case "batch-scripts": {
      const { batchScripts } = await import("./batch-scripts.js");
      await batchScripts(config, args);
      break;
    }
    case "produce": {
      const { produce } = await import("./produce.js");
      await produce(config, args);
      break;
    }
    case "detail": {
      const { detail } = await import("./detail.js");
      await detail(config, args);
      break;
    }
    case "fetch": {
      const { fetchPage } = await import("./fetch.js");
      await fetchPage(config, args);
      break;
    }
    case "rule-test": {
      const { ruleTest } = await import("./rule-test.js");
      await ruleTest(config, args);
      break;
    }
    case "console-script": {
      const { consoleScript } = await import("./console-script.js");
      await consoleScript(config, args);
      break;
    }
    case "paste": {
      const { paste } = await import("./paste.js");
      await paste(config, args);
      break;
    }
    case "guests": {
      const { guests } = await import("./guests.js");
      await guests(config, args);
      break;
    }
    case "guest-voice": {
      const { guestVoice } = await import("./guest-voice.js");
      await guestVoice(config, args);
      break;
    }
    case "guest-set": {
      const { guestSet } = await import("./guest-set.js");
      await guestSet(config, args);
      break;
    }
    case "progress": {
      const { progress } = await import("./progress.js");
      await progress(config, args);
      break;
    }
    case "script-preview": {
      const { scriptPreview } = await import("./script-preview.js");
      await scriptPreview(config, args);
      break;
    }
    case "tts": {
      const { tts } = await import("./tts.js");
      await tts(config, args);
      break;
    }
    case "merge": {
      const { merge } = await import("./merge.js");
      await merge(config, args);
      break;
    }
    case "cover": {
      const { cover } = await import("./cover.js");
      await cover(config, args);
      break;
    }
    case "publish": {
      const { publish } = await import("./publish.js");
      await publish(config, args);
      break;
    }
    case "reject": {
      const { reject } = await import("./reject.js");
      await reject(config, args);
      break;
    }
    default:
      console.error(`未知命令: ${cmd}\n\n` +
        "用法：pnpm editor <login|auth-status|overview|list|batch|batch-reject|batch-scripts|produce|detail|fetch|rule-test|console-script|paste|guests|guest-voice|guest-set|progress|script-preview|tts|merge|cover|publish|reject> [args]");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
