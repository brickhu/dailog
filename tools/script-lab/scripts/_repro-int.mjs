
import fs from 'node:fs';
import { complete } from '../lib/llm.mjs';
import { getPrompt, renderPrompt } from '../lib/prompt.mjs';
const env = {};
for (const line of fs.readFileSync('../.env', 'utf8').split(String.fromCharCode(10))) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const mini = {
  lang: 'zh',
  segments: [
    { speaker: 'guest', text: '你说得太对了，这是所有社交产品的死亡谷。没有男用户，女用户不来；没有女用户，男用户不留。解决冷启动不能靠烧钱换规模，那只会招来机器人和薅羊毛的。' },
    { speaker: 'guest', text: '比如可以先做一个单边价值突破，在匹配功能转动之前，先让产品对单个人也有用。不要一上来就做匹配，先做一个 AI 约会教练或自我探索工具。' },
    { speaker: 'guest', text: '当数据库有一千人时，AI 突然告诉用户：根据你的画像，我们发现库里有三个人与你灵魂契合度超过百分之九十。' }
  ]
};
const p = getPrompt('r3-polish');
const messages = renderPrompt(p, {
  scripts: JSON.stringify(mini, null, 1),
  dialogue: '[]',
  scope: 'all',
  target: '',
  revision: '',
  proposal: ''
});
const cfg = {
  apiKey: env.LLM_API_KEY,
  baseUrl: env.LLM_BASE_URL,
  model: env.LLM_MODEL,
  maxTokens: 8192,
  thinking: { type: 'disabled' }
};
Object.assign(cfg, p.config || {});
if (typeof cfg.thinking === "string") cfg.thinking = { type: cfg.thinking };
const out = await complete(cfg, messages.map(function (m) { return { role: m.role, content: m.content }; }), { stream: false });
fs.writeFileSync('/tmp/repro-out.txt', out);
console.log('RAW_LEN', out.length);
const segs = JSON.parse(out).segments || [];
console.log('SEGS', segs.length);
console.log('SPEAKERS', segs.map(function (s) { return s.speaker; }).join('>'));
segs.forEach(function (s, i) { console.log(i, s.speaker, String(s.text || '').slice(0, 60)); });
