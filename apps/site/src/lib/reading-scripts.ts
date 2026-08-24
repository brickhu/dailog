// 朗读文案：主流语言内置翻译（随代码打包，不依赖任何翻译接口）。
//  - 模板用 {name} 占位（插值主持人称呼）
//  - 未覆盖语种回退英文（isFallback=true，弹窗显示提示）
// 文案为固定短句（用于用户朗读 + 上传 transcript 供零样本克隆），各语言保持
// 「问候 + 自我介绍 + 分享对话 + 期望启发」结构一致。
const TEMPLATES: Record<string, string> = {
  zh: "大家好，我是{name}，欢迎收听 dailog。今天想和大家分享一段我和 AI 的对话，希望它能给你带来一些新的思考。",
  en: "Hi everyone, welcome to dailog. I'm {name}, your host today. I hope this conversation between me and AI gives you something new to think about.",
  ja: "皆さん、こんにちは。{name}です。dailogへようこそ。今日は、私とAIの会話を皆さんと共有したいと思います。それが皆さんにとって、何か新しい気づきになりますように。",
  ko: "안녕하세요, {name}입니다. dailog에 오신 것을 환영합니다. 오늘은 제가 AI와 나눈 대화를 여러분과 나누고 싶습니다. 여러분께 새로운 생각을 드릴 수 있기를 바랍니다.",
  fr: "Bonjour à tous, bienvenue sur dailog. Je suis {name}, votre hôte aujourd'hui. J'aimerais partager avec vous une conversation entre moi et une IA, en espérant qu'elle vous apporte de nouvelles idées.",
  de: "Hallo zusammen, willkommen bei dailog. Ich bin {name}, euer Moderator heute. Ich möchte ein Gespräch zwischen mir und einer KI mit euch teilen, in der Hoffnung, dass es euch zu neuen Gedanken anregt.",
  es: "Hola a todos, bienvenidos a dailog. Soy {name}, su anfitrión de hoy. Quiero compartir con ustedes una conversación entre mí y una IA, con la esperanza de que les traiga algo nuevo en qué pensar.",
  ru: "Всем привет, добро пожаловать на dailog. Сегодня ваш ведущий — {name}. Хочу поделиться с вами разговором между мной и искусственным интеллектом, надеюсь, он подарит вам новые мысли.",
  pt: "Olá a todos, bem-vindos ao dailog. Sou {name}, o seu anfitrião de hoje. Quero partilhar convosco uma conversa entre mim e uma IA, esperando que vos traga novas ideias.",
  it: "Ciao a tutti, benvenuti su dailog. Sono {name}, il vostro ospite di oggi. Voglio condividere con voi una conversazione tra me e un'intelligenza artificiale, sperando che vi dia nuovi spunti di riflessione.",
  ar: "مرحباً بالجميع، أهلاً بكم في dailog. أنا {name}، مضيفكم اليوم. أود أن أشارككم محادثة جرت بيني وبين الذكاء الاصطناعي، آملاً أن تمنحكم أفكاراً جديدة.",
  hi: "नमस्ते, dailog में आपका स्वागत है। मैं {name} हूँ, आज का आपका होस्ट। आज मैं अपनी और AI की बातचीत आपके साथ साझा करना चाहता हूँ, उम्मीद है कि यह आपको कुछ नया सोचने का मौका देगी।",
  th: "สวัสดีทุกคน ยินดีต้อนรับสู่ dailog ฉันชื่อ{name} เป็นพิธีกรของคุณในวันนี้ วันนี้ฉันอยากแบ่งปันบทสนทนาระหว่างฉันกับ AI ให้ทุกคนได้ฟัง หวังว่ามันจะทำให้คุณได้คิดอะไรใหม่ ๆ",
  vi: "Xin chào tất cả mọi người, chào mừng đến với dailog. Tôi là {name}, người dẫn chương trình hôm nay. Hôm nay tôi muốn chia sẻ với các bạn một cuộc trò chuyện giữa tôi và AI, hy vọng nó sẽ mang đến cho bạn những suy nghĩ mới.",
  id: "Halo semuanya, selamat datang di dailog. Saya {name}, host Anda hari ini. Hari ini saya ingin berbagi percakapan antara saya dan AI, semoga memberi Anda pemikiran baru.",
  ms: "Hai semua, selamat datang ke dailog. Saya {name}, hos anda hari ini. Hari ini saya ingin berkongsi perbualan antara saya dan AI, semoga ia memberi anda idea baharu.",
  tr: "Herkese merhaba, dailog'a hoş geldiniz. Ben {name}, bugünkü sunucunuz. Bugün sizinle benimle bir yapay zekâ arasındaki bir sohbeti paylaşmak istiyorum, umarım size yeni düşünceler kazandırır.",
  nl: "Hallo allemaal, welkom bij dailog. Ik ben {name}, jullie gastheer vandaag. Ik wil graag een gesprek tussen mij en een AI met jullie delen, in de hoop dat het jullie nieuwe ideeën oplevert.",
  pl: "Witam wszystkich, witajcie w dailog. Jestem {name}, waszym gospodarzem dzisiaj. Chcę podzielić się z wami rozmową między mną a sztuczną inteligencją, mając nadzieję, że przyniesie wam nowe przemyślenia.",
  uk: "Привіт усім, ласкаво просимо до dailog. Я {name}, ваш ведучий сьогодні. Хочу поділитися з вами розмовою між мною та штучним інтелектом, сподіваюся, вона подарує вам нові думки.",
  sv: "Hej allihopa, välkomna till dailog. Jag är {name}, er värd idag. Jag vill dela ett samtal mellan mig och en AI med er, i hopp om att det ger er nya tankar.",
  no: "Hei alle sammen, velkommen til dailog. Jeg er {name}, verten deres i dag. Jeg vil dele en samtale mellom meg og en AI med dere, i håp om at den gir dere nye tanker.",
  da: "Hej allesammen, velkommen til dailog. Jeg er {name}, jeres vært i dag. Jeg vil gerne dele en samtale mellem mig og en AI med jer, i håb om at den giver jer nye tanker.",
  fi: "Hei kaikki, tervetuloa dailogiin. Olen {name}, juontajanne tänään. Haluan jakaa kanssanne keskustelun minun ja tekoälyn välillä, toivoen että se antaa teille uusia ajatuksia.",
  cs: "Ahoj všichni, vítejte na dailog. Jsem {name}, váš dnešní moderátor. Chci se s vámi podělit o rozhovor mezi mnou a umělou inteligencí, doufám, že vám přinese nové myšlenky.",
  sk: "Ahoj všetci, vitajte na dailog. Som {name}, váš dnešný moderátor. Chcem sa s vami podeliť o rozhovor medzi mnou a umelou inteligenciou, dúfam, že vám prinesie nové myšlienky.",
  el: "Γεια σας, καλώς ήρθατε στο dailog. Είμαι ο/η {name}, ο παρουσιαστής σας σήμερα. Θέλω να μοιραστώ μαζί σας μια συνομιλία μεταξύ εμού και μιας τεχνητής νοημοσύνης, ελπίζοντας να σας δώσει νέες ιδέες.",
  he: "שלום לכולם, ברוכים הבאים ל-dailog. אני {name}, המנחה שלכם היום. אני רוצה לשתף אתכם בשיחה ביני לבין בינה מלאכותית, בתקווה שתעניק לכם מחשבות חדשות.",
  hu: "Üdv mindenkinek, üdvözlöm önöket a dailog-on. Én vagyok {name}, a mai házigazdájuk. Szeretném megosztani önökkel egy beszélgetésemet egy mesterséges intelligenciával, remélve, hogy új gondolatokat ad.",
  ro: "Salut tuturor, bun venit la dailog. Sunt {name}, gazda dumneavoastră de astăzi. Vreau să împărtășesc cu voi o conversație între mine și o inteligență artificială, sperând că vă va aduce idei noi.",
  bg: "Здравейте на всички, добре дошли в dailog. Аз съм {name}, вашият водещ днес. Искам да споделя с вас разговор между мен и изкуствения интелект, надявайки се, че ще ви донесе нови мисли.",
};

const FALLBACK_CODE = "en";

export interface ReadingScript {
  /** 插值称呼后的完整文案（= 上传的 transcript） */
  text: string;
  /** 该语种无内置文案 → 已回退英文 */
  isFallback: boolean;
  /** 实际生效的文案语种（回退时为 en） */
  lang: string;
}

/** 取朗读文案：主流语言用内置翻译；未覆盖语种回退英文 */
export function getReadingScript(lang: string, name: string): ReadingScript {
  const has = Object.prototype.hasOwnProperty.call(TEMPLATES, lang);
  const code = has ? lang : FALLBACK_CODE;
  return {
    text: TEMPLATES[code].replace(/\{name\}/g, name),
    isFallback: !has,
    lang: code,
  };
}
