// /terms — dailog 使用条款（中英双语）
// 法律文本较长，为保持可维护性，内容以结构化数据存放于本文件（随 locale() 响应式切换），
// 不塞入全局词典；页面 chrome（标题等）也一并内联。修改法律措辞只需改 TERMS 对象。
import { For } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, layouts, typography } from "@dailogues/ui/theme.stylex";
import { useI18n, type Locale } from "@dailogues/i18n";

// 联系邮箱（上线前替换为真实地址）
const CONTACT_EMAIL = "hello@dailog.fm";

interface TermSection {
  heading: string;
  /** 段落列表；每项渲染为一个 <p> */
  body: string[];
}

interface TermsDoc {
  title: string;
  effective: string;
  intro: string;
  sections: TermSection[];
}

const TERMS: Record<Locale, TermsDoc> = {
  zh: {
    title: "使用条款",
    effective: "生效日期：2026 年 8 月 18 日",
    intro:
      "欢迎使用 dailog（dailog.fm）——一档将人类与 AI 的真实对话制作为音频节目的播客。本使用条款（“条款”）是您与 dailog 运营方（下称“dailog”、“我们”）之间就您访问和使用 dailog 网站、播放页、RSS 订阅、账号、投稿及相关服务（合称“服务”）达成的协议。访问或使用服务，即表示您已阅读、理解并同意受本条款约束。如您不同意本条款，请勿使用服务。",
    sections: [
      {
        heading: "1. 服务说明",
        body: [
          "dailog 是一档播客频道：任何用户可注册账号并投稿“AI 对话分享链接 + 声音采样（30 秒以内）+ 可选的节目建议”，由 dailog 编辑依据公开的编辑标准对投稿进行审阅与制作（包括拉取对话内容、生成脚本、语音合成、制作封面），通过的投稿将发布为公开节目，并通过 dailog 单一 feed（RSS）分发至 Apple Podcasts、Spotify、小宇宙等播客平台。",
          "目前（v1）投稿与收听均免费，dailog 不向用户收取任何费用；未来若引入付费功能，相关条款将另行约定并提前告知。",
        ],
      },
      {
        heading: "2. 账号与注册",
        body: [
          "2.1 注册服务需提供有效的电子邮箱并完成邮箱验证。您须年满 16 周岁方可注册；未满 18 周岁的，须在父母或监护人同意并监督下使用服务。",
          "2.2 您须对账号下的所有行为负责，妥善保管账号与密码；如发现账号被未授权使用，应立即通知我们。账号不可转让、不可出借。",
        ],
      },
      {
        heading: "3. 投稿与授权",
        body: [
          "3.1 投稿即表示您向我们提交：对话分享链接及其所指向的对话内容、声音采样、可选的节目建议与主持人资料。",
          "3.2 权利保证：您声明并保证——您有权分享所投稿的对话（包括遵守相关对话平台的服务条款），且投稿内容不侵犯任何第三方的著作权、商标权、隐私权、名誉权、人格权或其他合法权益。",
          "3.3 声音授权：声音采样必须为您本人的声音。您授予 dailog 及其合作方一项不可撤销、非独占、全球范围、免版税的权利，将您的采样用于语音克隆、节目制作（含脚本配音、混音）、发布与分发，包括在上述节目中呈现您的克隆音色。您不得提交或冒用他人的声音。",
          "3.4 使用许可：您授予 dailog 一项非独占、全球范围、免版税、可再许可的许可，以对投稿内容进行审阅、存储、复制、编辑、改编与转换（包括脚本化、语音合成、音频拼接、封面制作），并发布、传播、推广 dailog 节目。",
          "3.5 所有权：您保留对原始对话及其内容的所有权，本条款不转移上述所有权。已发布的节目作为 dailog 频道的公开内容，由 dailog 依本条款管理。",
        ],
      },
      {
        heading: "4. 编辑与发布",
        body: [
          "4.1 是否收录投稿由 dailog 编辑依据公开的编辑标准（包括但不限于选题价值、提问保真、内容安全与质量门槛）独立判断。dailog 不保证任何投稿会被收录，也无义务就具体判断作出完整解释。",
          "4.2 未收录的投稿将被标记为“拒审”并附原因通知您；收录的投稿将按流程制作并发布为节目（期号顺延），发布后您会收到站内通知与邮件。",
          "4.3 投稿状态包括：submitted（待审核）、rejected（拒审）、published（已发布）。",
        ],
      },
      {
        heading: "5. 用户行为规范",
        body: [
          "您承诺在使用服务时遵守法律法规与本条款，不得：",
          "5.1 提交违法、侵权、虚假、欺诈、骚扰、仇恨、色情、暴力或宣扬伤害他人的内容；",
          "5.2 冒用他人身份或声音，或未经授权提交他人信息；",
          "5.3 批量、重复或滥用性投稿，干扰 dailog 编辑队列与服务运行；",
          "5.4 反向工程、破解、干扰、破坏或规避 dailog 服务、数据、接口或安全措施；",
          "5.5 未经许可抓取、爬取或滥用 dailog 网站、feed 或数据；",
          "5.6 利用服务从事任何违法活动。",
        ],
      },
      {
        heading: "6. 知识产权",
        body: [
          "dailog 品牌名称、标识、网站与平台、dailog 品牌声线、由 dailog 制作的节目成品（作为汇编作品）及其中的编辑加工内容，相关权利归 dailog 及其许可方所有。除本条款明确授予的权利外，未授予您任何其他权利。",
        ],
      },
      {
        heading: "7. 举报与下架",
        body: [
          "7.1 任何人可就涉嫌违反本条款或法律法规的节目向我们举报；dailog 有权依合理判断移除或下架违规内容、隐藏节目、限制或终止相关账号。",
          "7.2 投稿人可在个人中心对其已发布节目执行下架（下架后仅自己可见），并可随时重新上架。",
        ],
      },
      {
        heading: "8. 免责声明",
        body: [
          "服务按“现状”与“现有”基础提供，dailog 不作任何明示或暗示的担保，包括但不限于适销性、特定用途适用性与不侵权的担保。节目内容由投稿人提供并经编辑加工，dailog 不对内容的准确性、完整性、时效性作任何保证。对话平台与播客平台等第三方服务的行为不在 dailog 控制范围内。",
        ],
      },
      {
        heading: "9. 责任限制",
        body: [
          "在法律允许的最大范围内，dailog 不对因使用或无法使用服务、或依赖服务内容而产生的任何间接、附带、特殊、后果性或惩罚性损害承担责任。dailog 对您的总责任不超过您在引发责任的事件发生前三个月内实际向 dailog 支付的费用（如适用；当前 v1 阶段为零）。",
        ],
      },
      {
        heading: "10. 服务变更与终止",
        body: [
          "我们可能随时变更、暂停或终止服务（包括功能、节目或 feed），并会尽力在合理可行时提前通知。我们也可能因您违反本条款而暂停或终止您的账号。",
        ],
      },
      {
        heading: "11. 条款变更",
        body: [
          "我们可能不时更新本条款。重大变更将通过 dailog.fm 公告、站内通知等方式告知。变更生效后，您继续使用服务即视为接受更新后的条款。",
        ],
      },
      {
        heading: "12. 适用法律与争议解决",
        body: [
          "本条款的解释与适用以 dailog 运营方所在地的法律为准（在不与强制性法律规定冲突的前提下）。因本条款或服务产生的争议，双方应首先友好协商解决；协商不成的，提交运营方所在地有管辖权的法院解决。",
        ],
      },
      {
        heading: "13. 联系我们",
        body: ["如对本条款或服务有任何疑问，请联系我们：" + CONTACT_EMAIL],
      },
    ],
  },
  en: {
    title: "Terms of Use",
    effective: "Effective date: August 18, 2026",
    intro:
      "Welcome to dailog (dailog.fm) — a podcast that turns real conversations between humans and AI into audio episodes. These Terms of Use (“Terms”) are an agreement between you and the operator of dailog (“dailog”, “we”, “us”) governing your access to and use of the dailog website, episode pages, RSS feed, accounts, submissions and related services (collectively, the “Service”). By accessing or using the Service, you acknowledge that you have read, understood and agree to be bound by these Terms. If you do not agree, please do not use the Service.",
    sections: [
      {
        heading: "1. About the Service",
        body: [
          "dailog is a podcast channel: any user may register an account and submit a share link of an AI conversation, a voice sample (within 30 seconds), and an optional program suggestion. dailog editors review and produce accepted submissions in accordance with our published editorial standards (including fetching the conversation, generating a script, synthesizing audio and creating a cover), and publish them as public episodes distributed through the dailog single feed (RSS) to podcast platforms such as Apple Podcasts, Spotify and Xiaoyuzhou.",
          "At present (v1), both submission and listening are free of charge; dailog does not charge users any fees. If paid features are introduced in the future, the relevant terms will be set out separately and announced in advance.",
        ],
      },
      {
        heading: "2. Accounts and Registration",
        body: [
          "2.1 To use the Service you must provide a valid email address and complete email verification. You must be at least 16 years old to register; if you are under 18, you may only use the Service with the consent and supervision of a parent or guardian.",
          "2.2 You are responsible for all activity under your account and for keeping your credentials secure. If you suspect unauthorized use of your account, notify us immediately. Accounts may not be transferred or lent.",
        ],
      },
      {
        heading: "3. Submissions and Licenses",
        body: [
          "3.1 By submitting, you provide us with the share link and the conversation it points to, a voice sample, and (optionally) a program suggestion and host profile.",
          "3.2 Warranties: you represent and warrant that you have the right to share the submitted conversation (including compliance with the terms of the relevant conversation platform) and that your submission does not infringe any third party’s copyrights, trademarks, privacy rights, reputation or personality rights, or other legal interests.",
          "3.3 Voice authorization: the voice sample must be your own voice. You grant dailog and its partners an irrevocable, non-exclusive, worldwide, royalty-free right to use your sample for voice cloning, episode production (including scripted dubbing and mixing), publication and distribution, including presenting your cloned voice in such episodes. You may not submit or impersonate another person’s voice.",
          "3.4 License: you grant dailog a non-exclusive, worldwide, royalty-free, sublicensable license to review, store, reproduce, edit, adapt and transform your submissions (including scripting, speech synthesis, audio assembly and cover creation), and to publish, distribute and promote dailog episodes.",
          "3.5 Ownership: you retain ownership of the original conversation and its content; nothing in these Terms transfers that ownership. Published episodes, as public content of the dailog channel, are managed by dailog under these Terms.",
        ],
      },
      {
        heading: "4. Editorial Review and Publication",
        body: [
          "4.1 Whether a submission is accepted is decided independently by dailog editors in accordance with our published editorial standards (including, without limitation, topic value, question fidelity, content safety and quality thresholds). dailog does not guarantee that any submission will be accepted and is not obliged to provide a complete explanation of any particular decision.",
          "4.2 Rejected submissions are marked as rejected with a reason notified to you; accepted submissions are produced and published as episodes (numbered sequentially), and you will receive in-app and email notifications upon publication.",
          "4.3 Submission statuses include: submitted, rejected and published.",
        ],
      },
      {
        heading: "5. User Conduct",
        body: [
          "You agree to comply with applicable laws and these Terms when using the Service, and not to:",
          "5.1 submit unlawful, infringing, false, fraudulent, harassing, hateful, obscene, violent or harmful content;",
          "5.2 impersonate another person or their voice, or submit another person’s information without authorization;",
          "5.3 engage in bulk, repeated or abusive submissions that interfere with dailog’s editorial queue or the operation of the Service;",
          "5.4 reverse engineer, crack, interfere with, disrupt or circumvent the Service, its data, interfaces or security measures;",
          "5.5 scrape, crawl or misuse the dailog website, feed or data without authorization;",
          "5.6 use the Service for any unlawful activity.",
        ],
      },
      {
        heading: "6. Intellectual Property",
        body: [
          "The dailog brand name, logo, website and platform, the dailog brand voice, and the finished episodes produced by dailog (as collective works) and the editorial content therein are owned by dailog and its licensors. Except for the rights expressly granted in these Terms, no other rights are granted to you.",
        ],
      },
      {
        heading: "7. Reporting and Takedown",
        body: [
          "7.1 Anyone may report episodes they believe violate these Terms or applicable law. dailog may, in its reasonable discretion, remove or take down violating content, hide episodes, or restrict or terminate related accounts.",
          "7.2 Submitters may take down their published episodes from their personal center (after takedown the episode is visible only to themselves) and re-list them at any time.",
        ],
      },
      {
        heading: "8. Disclaimer",
        body: [
          "The Service is provided on an “as is” and “as available” basis. dailog makes no warranties, express or implied, including but not limited to merchantability, fitness for a particular purpose and non-infringement. Episode content is provided by submitters and edited by dailog; dailog makes no guarantees as to the accuracy, completeness or timeliness of any content. Third-party services such as conversation platforms and podcast platforms are outside dailog’s control.",
        ],
      },
      {
        heading: "9. Limitation of Liability",
        body: [
          "To the maximum extent permitted by law, dailog shall not be liable for any indirect, incidental, special, consequential or punitive damages arising from or in connection with the use of or inability to use the Service, or reliance on its content. dailog’s total liability to you shall not exceed the amounts actually paid by you to dailog in the three months preceding the event giving rise to liability (if any; currently zero in the v1 phase).",
        ],
      },
      {
        heading: "10. Changes, Suspension and Termination",
        body: [
          "We may change, suspend or terminate the Service (including features, episodes or the feed) at any time, and will use reasonable efforts to notify you in advance where practicable. We may also suspend or terminate your account if you breach these Terms.",
        ],
      },
      {
        heading: "11. Changes to These Terms",
        body: [
          "We may update these Terms from time to time. Material changes will be announced on dailog.fm or notified in-app. Your continued use of the Service after such changes take effect constitutes acceptance of the updated Terms.",
        ],
      },
      {
        heading: "12. Governing Law and Dispute Resolution",
        body: [
          "These Terms are governed by the laws of the jurisdiction where the dailog operator is located (without prejudice to any mandatory legal provisions). Any dispute arising out of or in connection with these Terms or the Service shall first be resolved through friendly negotiation; if negotiation fails, the dispute shall be submitted to the courts of competent jurisdiction in the operator’s location.",
        ],
      },
      {
        heading: "13. Contact Us",
        body: ["If you have any questions about these Terms or the Service, please contact us at: " + CONTACT_EMAIL],
      },
    ],
  },
};

// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (min-width: 1025px)";

const styles = stylex.create({
  page: {

    paddingBottom: "72px", // 播放条高度预留
  },
  content: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: dimensions.spacing8 + " " + dimensions.spacing4 + " " + dimensions.spacing12,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    paddingBottom: dimensions.spacing6,
  },
  title: {

    lineHeight: "1.2",
    margin: 0,
  },
  meta: {
   
  },
  intro: {
 
    lineHeight: 1.5,
    margin: 0,
  },
  section: {
    paddingTop: dimensions.spacing6,
  },
  h2: {
    margin: "0 0 " + dimensions.spacing3,
    color: colors.foreground,
  },
  p: {
    lineHeight: 1.5,
    margin: "0 0 " + dimensions.spacing3,
    color: colors.foreground,
  },
  pLast: {
    marginBottom: 0,
  },
  contact: {
    marginTop: dimensions.spacing8,
    paddingTop: dimensions.spacing6,
  },
  contactText: {
    lineHeight: 1.6,
    margin: 0,
  },
});

export default function TermsPage() {
  // 语言跟随全局 i18n（导航栏 LangSwitch 切换，cookie 持久化），页内不提供独立切换
  const { locale } = useI18n();
  const doc = () => TERMS[locale()] ?? TERMS.en;

  return (
    <div {...stylex.props(styles.page,layouts.page)}>
      <div {...stylex.props(styles.content)}>
        <Title>{doc().title} · dailog</Title>

        <header {...stylex.props(styles.header)}>
          <h1 {...stylex.props(typography.headingLg)}>{doc().title}</h1>
          <p {...stylex.props(typography.caption)}>{doc().effective}</p>
        </header>

        <p {...stylex.props(styles.intro)}>{doc().intro}</p>

        <For each={doc().sections}>
          {(s) => (
            <section {...stylex.props(styles.section)}>
              <h2 {...stylex.props(styles.h2,typography.headingXs)}>{s.heading}</h2>
              <For each={s.body}>
                {(para, j) => (
                  <p {...stylex.props(styles.p, j() === s.body.length - 1 && styles.pLast)}>{para}</p>
                )}
              </For>
            </section>
          )}
        </For>

        <footer {...stylex.props(styles.contact)}>
          <p {...stylex.props(styles.contactText,typography.caption)}>
            {locale() === "zh"
              ? "© 2026 dailog.fm · 本条款以中英文撰写，两种版本具有同等效力；如有歧义，以中文版本为准。"
              : "© 2026 dailog.fm · These Terms are written in Chinese and English; both versions are equally binding. In case of any discrepancy, the Chinese version shall prevail."}
          </p>
        </footer>
      </div>
    </div>
  );
}
