# Webhook da Evolution — configuração e correção do bug "bot não responde"

## O que estava errado

Duas causas combinadas faziam o bot publicado ficar em silêncio:

1. **Webhook apontando para uma publicação antiga.** O endereço registrado
   neste projeto (`museterabot-rlburgyg.manus.space`) roda uma versão antiga
   do bot. O código atual roda em `botmusetera-nryykggd.manus.space`.
2. **Autenticação incompatível com o padrão da Evolution.** O servidor só
   aceitava o webhook se ele trouxesse o `WEBHOOK_SHARED_TOKEN` (header,
   `?token=` ou assinatura HMAC). A Evolution **não envia nada disso por
   padrão** — ela só envia o token se ele for configurado manualmente.
   Resultado: toda mensagem real recebia `401` e era descartada.

## O que o código corrigido aceita (branch `fix/webhook-evolution-auth`)

O webhook agora é aceito se **qualquer** um destes métodos validar:

| Método | Como a Evolution envia | Precisa configurar? |
| --- | --- | --- |
| Assinatura HMAC (`x-webhook-signature`) | Header com HMAC-SHA256 do corpo usando o `WEBHOOK_SHARED_TOKEN` | Sim, no chamador |
| Token compartilhado | Header `x-webhook-token` ou `?token=` na URL do webhook | Sim, simples |
| **Apikey no corpo (padrão Evolution)** | A Evolution já inclui o campo `apikey` no corpo de todo webhook; o servidor compara com o `EVOLUTION_API_KEY` configurado nele | **Não — funciona com a configuração padrão** |

Além disso:

- A assinatura HMAC passou a ser calculada sobre os **bytes exatos** da
  requisição (antes era sobre o JSON re-serializado, que pode divergir).
- A rota aceita também o sufixo do modo "webhook por eventos"
  (`/api/webhooks/evolution/messages-upsert`), que antes caía em 404.
- Quando um webhook é rejeitado, o log `webhook_rejected` agora mostra
  quais sinais de autenticação chegaram (`hasToken`, `hasPayloadApiKey`,
  `sharedTokenConfigured`, `evolutionKeyConfigured`) — sem expor valores.

## Passo a passo

### 1. Publicar o código corrigido

Publicar a versão com a correção (Publish). Endereço atual de produção:

```
https://botmusetera-nryykggd.manus.space
```

### 2. Conferir as variáveis de ambiente da publicação

Todas precisam existir **no ambiente publicado**:

| Variável | Para quê |
| --- | --- |
| `SUPABASE_URL` | Banco (o servidor nem sobe sem ela) |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso administrativo ao Supabase |
| `EVOLUTION_API_URL` | Endereço da Evolution (ex.: `http://SEU_IP:8080`) — **não** é a chave |
| `EVOLUTION_API_KEY` | Chave da Evolution; também valida o webhook (método padrão) |
| `EVOLUTION_INSTANCE_NAME` | Ex.: `financeiro` |
| `WEBHOOK_SHARED_TOKEN` | Segredo dos métodos HMAC/token (recomendado manter) |
| `MERCADOPAGO_ACCESS_TOKEN` | Cobranças Pix |
| `PUBLIC_APP_URL` | URL pública desta publicação |

### 3. Configurar o webhook na instância da Evolution

Na instância `financeiro`:

- **URL:** `https://botmusetera-nryykggd.manus.space/api/webhooks/evolution`
- **Eventos:** ativar `MESSAGES_UPSERT` (é o único que o bot processa)
- **Webhook por eventos (byEvents):** pode deixar desligado; se ligar, a
  rota com sufixo também funciona
- **Headers personalizados:** não precisa (a Evolution já manda a `apikey`
  no corpo). Reforço opcional: usar a URL com token —
  `.../api/webhooks/evolution?token=<WEBHOOK_SHARED_TOKEN>`

Pela API da Evolution é o endpoint `POST /webhook/set/financeiro` com o
corpo:

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://botmusetera-nryykggd.manus.space/api/webhooks/evolution",
    "byEvents": false,
    "base64": false,
    "events": ["MESSAGES_UPSERT"]
  }
}
```

> Não deixar o webhook apontando para o endereço antigo
> (`museterabot-rlburgyg.manus.space`).

### 4. Conferir a instância no Supabase

A tabela `whatsapp_instances` precisa ter a linha da instância `financeiro`
com `is_active = true`. Se o nome que a Evolution envia não casar com
nenhuma instância ativa, o webhook responde 200 mas ignora a mensagem
(log `webhook_unknown_instance`).

### 5. Testar

1. Saúde: `GET https://botmusetera-nryykggd.manus.space/api/webhooks/evolution`
   deve responder `{"ok":true,"service":"musetera-bot"}`.
2. Enviar uma mensagem real de outro número para o WhatsApp do bot
   (`558185436981`) e aguardar a resposta do menu.
3. No log do servidor, o caminho feliz registra `message_processed`.

## Leitura dos logs em caso de falha

| Evento no log | Significado | Correção |
| --- | --- | --- |
| `webhook_rejected` | Autenticação não validou; os campos `hasToken`/`hasPayloadApiKey`/`sharedTokenConfigured`/`evolutionKeyConfigured` mostram o que faltou | Conferir passo 2 e 3 |
| `webhook_unknown_instance` | Instância do payload não está ativa no Supabase | Passo 4 |
| `webhook_conversation_failed` / `webhook_state_failed` | Erro de banco ao salvar conversa/estado | Conferir Supabase e RLS |
| `evolution_send_failed` | O bot processou, mas o envio da resposta falhou | Conferir `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` (passo 2) |
| `message_processed` | Tudo certo | — |
