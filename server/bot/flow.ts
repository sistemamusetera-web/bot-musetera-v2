// MuseTera bot conversation flow.
// Menu numbering: options 1-5 + 0 (pause). Multi-step state is persisted
// in the database (handled by webhook-handler.ts).

export type StepId =
  | "main"
  | "welcome"
  | "support_waiting"
  | "bug_wait_text"
  | "bug_wait_date"
  | "plans_choose_method"
  | "plans_choose_pix"
  | "plans_choose_credit";

export const REACTIVATION_WORDS = ["menu", "início", "inicio", "oi", "olá", "ola"];

// ===== WELCOME (etapa antes do menu) =====

export const WELCOME_TEXT = `🎵 *MuseTera* 🎶
_Sistema para Musicoterapeutas_ ✨

Olá! 👋 Que bom te ver por aqui! 💙
Você já é cliente MuseTera? 👇

1️⃣ ✅ *Já sou cliente*
2️⃣ 🌟 *Quero conhecer*

👆 _Toque um botão ou digite o número._`;

export const WELCOME_BUTTONS = [
  { id: "welcome_client", title: "✅ Já sou cliente" },
  { id: "welcome_new", title: "🌟 Quero conhecer" },
] as const;

export const MAIN_MENU = `🎵 *MuseTera* 🎶
_Sistema para Musicoterapeutas_ ✨

Olá! 👋 Seja bem-vindo(a)! 💙
Como posso te ajudar hoje? 👇

━━━━━━━━━━━━━━
1️⃣ 💬 *Falar com suporte*
2️⃣ 💳 *Planos e pagamentos*
3️⃣ 🐞 *Reportar um bug*
4️⃣ ✨ *Como funciona?*
5️⃣ 🔄 *Renovar plano*
━━━━━━━━━━━━━━

👆 _Digite o número da opção_
⏸️ *0* encerrar • 🔙 *menu* voltar`;

// ===== MENU PRINCIPAL — versão para LIST interativa do WhatsApp =====

export const MAIN_MENU_LIST_TEXT = `✨ Por aqui você resolve tudo em segundos! 🚀

👇 *Toque no botão* abaixo para abrir o menu, ou digite o número da opção (*1* a *5*).

⚡ _Atalhos:_ *1* 💬 suporte • *0* ⏸️ encerrar • *menu* 🔙 voltar`;

export const MAIN_MENU_LIST_BUTTON = "📋 Menu de opções";

export const MAIN_MENU_SECTIONS = [
  {
    title: "Como podemos te ajudar? 💙",
    rows: [
      { id: "menu_1", title: "1️⃣ Falar com o suporte", description: "Atendimento humano em minutos 🤝" },
      { id: "menu_2", title: "2️⃣ Planos e pagamentos", description: "Conheça nossos valores e assine já 🚀" },
      { id: "menu_3", title: "3️⃣ Reportar um bug", description: "Encontrou um problema? Conte pra gente 🛠️" },
      { id: "menu_4", title: "4️⃣ Como funciona?", description: "Tour completo pela plataforma 🎵" },
      { id: "menu_5", title: "5️⃣ Renovar plano", description: "Renove sua assinatura em segundos ⚡" },
    ],
  },
] as const;

export const SUPPORT_ENTRY =
  "💬 *Suporte humano*\n\nUm atendente foi notificado e responderá em breve.\n\n_Digite *menu* para voltar._";

export const SUPPORT_WAITING =
  "👨‍💼 Você já está na fila. Um agente responderá em breve.\n\n_Digite *menu* para voltar._";

export const PLANS_TEXT = `💳 *Planos MuseTera* ✨

🗓️ 30 Dias — *R$ 34,90*
📅 6 Meses — *R$ 200,00* 🔥
🏆 12 Meses — *R$ 400,00* 👑 _melhor custo-benefício!_

👉 _Para escolher um plano e pagar, digite *2* no menu._`;

// ---- Planos / Pagamento ----

export interface PlanInfo {
  id: "30d" | "6m" | "1y";
  label: string;
  price: number; // BRL
  priceLabel: string;
}

export const PLANS: Record<PlanInfo["id"], PlanInfo> = {
  "30d": {
    id: "30d",
    label: "30 Dias",
    price: 34.9,
    priceLabel: "R$ 34,90",
  },
  "6m": {
    id: "6m",
    label: "6 Meses",
    price: 200.0,
    priceLabel: "R$ 200,00",
  },
  "1y": {
    id: "1y",
    label: "12 Meses",
    price: 400.0,
    priceLabel: "R$ 400,00",
  },
};

export const PAYMENT_METHOD_PROMPT = `💳 *Planos MuseTera* ✨

Como você prefere pagar? 👇

1️⃣ ⚡ *PIX* — aprovação na hora ✅
2️⃣ 💳 *Cartão* — em até 12x 🎉

🔙 _Digite *menu* para voltar._`;

export const RENEW_PROMPT = `🔄 *Renovar plano* ✨

Que bom te ver de volta! 💙
Vamos renovar sua assinatura MuseTera. Como você prefere pagar? 👇

1️⃣ ⚡ *PIX* — aprovação na hora ✅
2️⃣ 💳 *Cartão* — em até 12x 🎉

🔙 _Digite *menu* para voltar._`;

export const planChoicePrompt = (method: "pix" | "credit") => {
  const title = method === "pix" ? "⚡ *PIX*" : "💳 *Cartão de crédito*";
  return `${title}

🎯 Escolha seu plano: 👇

1️⃣ 🗓️ *30 Dias* — R$ 34,90
2️⃣ 📅 *6 Meses* — R$ 200,00 🔥
3️⃣ 🏆 *12 Meses* — R$ 400,00 👑 _melhor custo-benefício!_

🔙 _Digite *menu* para voltar._`;
};

export const pixSuccess = (plan: PlanInfo) =>
  `✅ *PIX gerado!*

📦 ${plan.label} — *${plan.priceLabel}*

⏰ Expira em 30 min
📩 Envie o comprovante após pagar

👇 *O código PIX copia e cola vai sozinho na próxima mensagem* — toque e segure nele pra copiar.

_Digite *menu* para voltar._`;

export const creditSuccess = (plan: PlanInfo, checkoutUrl: string) =>
  `💳 *Pagamento por cartão — Mercado Pago*

📦 ${plan.label} — *${plan.priceLabel}*

🔗 ${checkoutUrl}

✨ Até 12x • Mercado Pago
📩 Envie o comprovante após pagar

_Digite *menu* para voltar._`;

export const PIX_ERROR =
  "❌ Não foi possível gerar o PIX. Tente novamente ou digite *1* para falar com o suporte.";

export const paymentApproved = (planLabel: string, amountLabel: string, paymentId: string) =>
  `✅ *Pagamento confirmado!*\n\n📦 Plano: *${planLabel}*\n💰 Valor: *${amountLabel}*\n🆔 ID: ${paymentId}\n\nObrigado pela confiança! 💙\n\n👉 Acesse a plataforma: https://portal.musetera.com.br/login\n\nQualquer dúvida, digite *1* para falar com o suporte.`;

export const EMAIL_PROMPT = (plan: PlanInfo) =>
  `📧 *Quase lá!*

📦 Plano escolhido: *${plan.label} — ${plan.priceLabel}*

Pra liberar seu acesso ao portal MuseTera, me envie o seu *e-mail*:

_Ele vai ser o seu login no portal. Digite o e-mail completo, ex: nome@email.com_`;

export const EMAIL_INVALID =
  "⚠️ Esse e-mail não parece válido. Confira e envie de novo, por favor (ex: nome@email.com).";

export const ACCOUNT_FOUND_NOTICE =
  "✅ *Conta encontrada!* Reconheci seu e-mail no portal MuseTera — o pagamento será vinculado à sua conta.";

export const ACCOUNT_CREATED_NOTICE =
  "✅ *Conta criada no portal!* Guarde o e-mail e a senha que você acabou de criar — são eles que liberam seu acesso quando o pagamento for confirmado.";

export const PASSWORD_PROMPT = `🔐 *Crie a senha da sua conta*

Esse e-mail ainda não tem conta no portal MuseTera. Escolha uma senha pra ela — vai ser a sua senha de acesso ao portal, junto com esse e-mail.

Digite uma senha com pelo menos *6 caracteres*:`;

export const PASSWORD_INVALID =
  "⚠️ Essa senha não serve: ela precisa ter pelo menos 6 caracteres. Escolha outra, por favor:";

export const paymentCustomerPassword = (params: {
  planLabel: string;
  amountLabel: string;
  expiresLabel: string;
  email: string;
}) =>
  `🎉 *Pagamento confirmado e acesso liberado!*

📦 Plano: *${params.planLabel}*
💰 Valor: *${params.amountLabel}*
🗓️ *Acesso válido até ${params.expiresLabel}*

🔐 *Seu acesso ao portal:*
📧 E-mail: ${params.email}
🔑 Senha: a que você criou aqui no cadastro

👉 Acesse: https://portal.musetera.com.br/login

Qualquer dúvida, digite *1* para falar com o suporte.`;

export const paymentActivatedExisting = (params: {
  planLabel: string;
  amountLabel: string;
  expiresLabel: string;
  email: string;
}) =>
  `🎉 *Pagamento confirmado e acesso liberado!*

📦 Plano: *${params.planLabel}*
💰 Valor: *${params.amountLabel}*
🗓️ *Acesso válido até ${params.expiresLabel}*

👉 Entre no portal com o e-mail e a senha que você já usa:
https://portal.musetera.com.br/login
📧 E-mail da conta: ${params.email}

Qualquer dúvida, digite *1* para falar com o suporte.`;

export const paymentAccessGranted = (params: {
  planLabel: string;
  amountLabel: string;
  expiresLabel: string;
  email: string;
  password: string;
}) =>
  `🎉 *Pagamento confirmado e acesso liberado!*

📦 Plano: *${params.planLabel}*
💰 Valor: *${params.amountLabel}*
🗓️ *Acesso válido até ${params.expiresLabel}*

🔐 *Suas credenciais do portal:*
📧 E-mail: ${params.email}
🔑 Senha temporária: ${params.password}

👉 Acesse: https://portal.musetera.com.br/login

_Troque a senha no primeiro acesso, em Meu perfil._
Qualquer dúvida, digite *1* para falar com o suporte.`;

export const paymentRenewed = (params: {
  planLabel: string;
  amountLabel: string;
  expiresLabel: string;
  email: string;
}) =>
  `🔄 *Assinatura renovada!*

📦 Plano: *${params.planLabel}*
💰 Valor: *${params.amountLabel}*
🗓️ *Seu acesso agora vai até ${params.expiresLabel}*

👉 Acesse com seu e-mail e senha de sempre: https://portal.musetera.com.br/login
📧 E-mail da conta: ${params.email}

Qualquer dúvida, digite *1* para falar com o suporte.`;

export const INVALID_OPTION =
  "⚠️ Opção inválida. Digite o número da opção ou *menu* para voltar.";

export const BUG_PROMPT_TEXT =
  "🐞 *Reportar bug*\n\nDescreva o problema com o máximo de detalhes.";

export const BUG_PROMPT_DATE =
  "📅 Agora envie a data e hora em que ocorreu (ex: 27/04/2026 15:40).";

export const BUG_DONE =
  "✅ *Reporte registrado!*\n\nNossa equipe técnica vai analisar.\n\n_Digite *menu* para voltar._";

export const HOW_IT_WORKS = `✨ *Como usar o MuseTera*

*Primeiros passos*
👤 Cadastre seu perfil profissional
🖋️ Crie seu carimbo digital
🧑‍🤝‍🧑 Cadastre seus pacientes

*Processos Musicoterapia*
📋 Anamnese
📊 Avaliação
🎯 Plano Musicoterapêutico
🎵 Intervenção
📝 Relatório

_Tudo em: menu *Processos Musicoterapia* > escolha o item._

_Digite *menu* para voltar._`;

export const MUTE_NOTICE =
  "🔔 Atendimento automático pausado por 1h. Digite *menu* para reativar.";

export function isReactivationWord(text: string): boolean {
  return REACTIVATION_WORDS.includes(text.trim().toLowerCase());
}

export function getInitialMessage(): string {
  return MAIN_MENU;
}
