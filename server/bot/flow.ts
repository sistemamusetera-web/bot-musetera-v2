// MuseTera bot conversation flow.
// Mirrors the Express index.js exactly: same texts, same numbering (1-5 + 0),
// same multi-step flows. State that the Express version kept in memory
// (Maps) is now persisted in the database (handled by webhook.ts).

export type StepId =
  | "main"
  | "welcome"
  | "schedule_wait_datetime"
  | "support_waiting"
  | "bug_wait_text"
  | "bug_wait_date"
  | "register_wait_name"
  | "register_wait_email"
  | "register_wait_password"
  | "register_wait_phone"
  | "plans_choose_method"
  | "plans_choose_pix"
  | "plans_choose_credit";

export const REACTIVATION_WORDS = ["menu", "início", "inicio", "oi", "olá", "ola"];

// ===== WELCOME (etapa antes do menu) =====

export const WELCOME_TEXT = `🎵 *MuseTera* — _Sistema Para Musicoterapeutas_

Olá! 👋 Você já é cliente MuseTera?

*1* ✅ Já sou cliente
*2* 🌟 Quero conhecer

_Toque um botão ou digite o número._`;

export const WELCOME_BUTTONS = [
  { id: "welcome_client", title: "✅ Já sou cliente" },
  { id: "welcome_new", title: "🌟 Quero conhecer" },
] as const;

export const MAIN_MENU = `🎵 *MuseTera* — _Sistema Para Musicoterapeutas_

Olá! 👋 Como posso te ajudar hoje?

*1* 📅 Agendar apresentação
*2* 💬 Falar com suporte
*3* 💳 Planos e pagamentos
*4* 🐞 Reportar um bug
*5* ✨ Como funciona?
*6* 📝 Criar cadastro

_Digite o número da opção._
_*0* encerrar • *menu* voltar_`;

// ===== MENU PRINCIPAL — versão para LIST interativa do WhatsApp =====

export const MAIN_MENU_LIST_TEXT = `Por aqui você pode resolver tudo em segundos. ✨

➡️ *Toque no botão* abaixo para abrir o menu, ou digite o número da opção (*1* a *6*).

_Atalhos:_ digite *2* para falar com atendente, *0* para encerrar, *menu* para voltar.`;

export const MAIN_MENU_LIST_BUTTON = "📋 Menu de opções";

export const MAIN_MENU_SECTIONS = [
  {
    title: "Como podemos te ajudar?",
    rows: [
      { id: "menu_1", title: "1️⃣ Agendar apresentação", description: "Reserve sua aula demonstrativa" },
      { id: "menu_2", title: "2️⃣ Falar com o suporte", description: "Atendimento humano em minutos" },
      { id: "menu_3", title: "3️⃣ Planos e pagamentos", description: "Conheça nossos valores" },
      { id: "menu_4", title: "4️⃣ Reportar um bug", description: "Encontrou um problema? Conte pra gente" },
      { id: "menu_5", title: "5️⃣ Como funciona?", description: "Tour completo pela plataforma" },
      { id: "menu_6", title: "6️⃣ Cadastro na plataforma", description: "Crie sua conta agora mesmo" },
    ],
  },
] as const;

export const SCHEDULE_PROMPT =
  "📅 *Agendar apresentação*\n\nEnvie a data e o horário desejados (ex: 28/04/2026 14:30).";

export const scheduleConfirmation = (datetime: string) =>
  `✅ *Apresentação agendada!*\n\n📌 ${datetime}\n\n_Digite *menu* para voltar._`;

export const SUPPORT_ENTRY =
  "💬 *Suporte humano*\n\nUm atendente foi notificado e responderá em breve.\n\n_Digite *menu* para voltar._";

export const SUPPORT_WAITING =
  "👨‍💼 Você já está na fila. Um agente responderá em breve.\n\n_Digite *menu* para voltar._";

export const PLANS_TEXT = `💳 *Planos MuseTera*

🗓️ 30 Dias — *R$ 34,90*
📅 6 Meses — *R$ 199,00*
🏆 1 Ano — *R$ 299,00*

_Para escolher um plano e pagar, digite *3* no menu._`;

// ---- Planos / Pagamento ----

export interface PlanInfo {
  id: "30d" | "6m" | "1y";
  label: string;
  price: number; // BRL
  priceLabel: string;
  creditLink: string; // InfinitePay
}

// ⚠️ Atualize o link de 30 dias quando criar no painel InfinitePay.
export const PLANS: Record<PlanInfo["id"], PlanInfo> = {
  "30d": {
    id: "30d",
    label: "30 Dias",
    price: 34.9,
    priceLabel: "R$ 34,90",
    creditLink:
      "https://link.infinitepay.io/karloss_christian/VC1DLTEtUg-1wFkGQI6Yz-34,90",
  },
  "6m": {
    id: "6m",
    label: "6 Meses",
    price: 199.0,
    priceLabel: "R$ 199,00",
    creditLink:
      "https://link.infinitepay.io/karloss_christian/VC1DLTYtUg-QgJWgtnsP-199,00",
  },
  "1y": {
    id: "1y",
    label: "1 Ano",
    price: 299.0,
    priceLabel: "R$ 299,00",
    creditLink:
      "https://link.infinitepay.io/karloss_christian/VC1DLUMtUg-7kHgD4nE5n-299,00",
  },
};

export const PAYMENT_METHOD_PROMPT = `💳 *Planos MuseTera*

Como você prefere pagar?

*1* ⚡ PIX — aprovação na hora
*2* 💳 Cartão — até 12x

_Digite *menu* para voltar._`;

export const planChoicePrompt = (method: "pix" | "credit") => {
  const title = method === "pix" ? "⚡ PIX" : "💳 Cartão de crédito";
  return `${title}

Escolha seu plano:

*1* 🗓️ 30 Dias — R$ 34,90
*2* 📅 6 Meses — R$ 199,00
*3* 🏆 1 Ano — R$ 299,00

_Digite *menu* para voltar._`;
};

export const pixSuccess = (plan: PlanInfo, payUrl: string) =>
  `✅ *PIX gerado!*

📦 ${plan.label} — *${plan.priceLabel}*

🔗 ${payUrl}

⏰ Expira em 30 min
📩 Envie o comprovante após pagar
📝 Faça seu cadastro digitando *6*

_Digite *menu* para voltar._`;

export const creditSuccess = (plan: PlanInfo) =>
  `💳 *Pagamento por cartão*

📦 ${plan.label} — *${plan.priceLabel}*

🔗 ${plan.creditLink}

✨ Até 12x • InfinitePay (100% seguro)
📩 Envie o comprovante após pagar
📝 Faça seu cadastro digitando *6*

_Digite *menu* para voltar._`;

export const PIX_ERROR =
  "❌ Não foi possível gerar o PIX. Tente novamente ou digite *2* para falar com o suporte.";

export const paymentApproved = (planLabel: string, amountLabel: string, paymentId: string) =>
  `✅ *Pagamento confirmado!*\n\n📦 Plano: *${planLabel}*\n💰 Valor: *${amountLabel}*\n🆔 ID: ${paymentId}\n\nObrigado pela confiança! 💙\n\n👉 *Próximo passo:* digite *6* para criar seu cadastro e liberar o acesso à plataforma.`;

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

// ---- Cadastro (registro na plataforma MuseTera) ----

export const REGISTER_PROMPT_NAME =
  "📝 *Cadastro MuseTera*\n\nVamos criar sua conta. Digite *menu* para cancelar.\n\n👤 Qual é o seu *nome completo*?";

export const REGISTER_PROMPT_EMAIL =
  "📧 Envie seu *e-mail* (ex: nome@email.com).";

export const REGISTER_PROMPT_PASSWORD =
  "🔒 Crie uma *senha* (mín. 6 caracteres).\n\n_Recomendamos trocá-la após o primeiro acesso._";

export const REGISTER_PROMPT_PHONE =
  "📱 Envie seu *telefone* (+5511999999999) ou digite *pular*.";

export const registerSuccess = (email: string) =>
  `✅ *Cadastro enviado!*\n\nAguardando aprovação do administrador.\nLiberação será enviada para: ${email}\n\n🔗 https://portal.musetera.com.br/login\n\n_Digite *menu* para voltar._`;

export const REGISTER_ERROR_EMAIL_EXISTS =
  "⚠️ E-mail já cadastrado.\n\nAcesse https://portal.musetera.com.br/login ou digite *menu* para voltar.";

export const registerErrorInvalid = (field: string, reason: string) =>
  `⚠️ ${field} inválido: ${reason}\n\nTente novamente ou digite *menu* para cancelar.`;

export const REGISTER_ERROR_RATE_LIMIT =
  "⚠️ Muitas tentativas. Aguarde alguns minutos ou digite *2* para falar com o suporte.";

export const REGISTER_ERROR_GENERIC =
  "❌ Não foi possível concluir o cadastro. Tente novamente ou digite *2* para falar com o suporte.";

export function isReactivationWord(text: string): boolean {
  return REACTIVATION_WORDS.includes(text.trim().toLowerCase());
}

export function getInitialMessage(): string {
  return MAIN_MENU;
}
