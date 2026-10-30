# Projeto TODO

- [x] Auditar o código atual; o inventário confirmou que os dados históricos exigem acesso service_role de origem, indisponível.
- [x] Confirmar o esquema efetivo do Supabase de destino `tvmffyfjdfwywsufjllv` e documentar diferenças.
- [x] Recriar no novo Supabase todas as tabelas, tipos, índices, funções e políticas necessárias ao bot.
- [x] Não migrar conversas históricas: bloqueado por falta de acesso ao Supabase de origem e autorizado pelo usuário.
- [x] Não migrar mensagens históricas: bloqueado por falta de acesso ao Supabase de origem e autorizado pelo usuário.
- [x] Não migrar estados e cobranças PIX históricos: bloqueado por falta de acesso ao Supabase de origem e autorizado pelo usuário.
- [x] Configurar o backend operacional para usar exclusivamente o novo Supabase; autenticação do painel permanece no OAuth gerenciado pelo scaffold.
- [x] Garantir que chaves de serviço e segredos permaneçam somente em variáveis de ambiente do servidor.
- [x] Implementar validação de assinatura/autorização dos webhooks da Evolution.
- [x] Identificar a instância remetente em cada webhook e roteá-la corretamente.
- [x] Processar mensagens recebidas pela instância `financeiro` no número `558185436981`.
- [x] Manter `financeiro` ativa no cadastro de instâncias autorizadas.
- [x] Preservar o fluxo de novos atendimentos financeiros: menu, suporte, cadastro, planos, cartão e PIX.
- [x] Implementar envio de mensagens pela Evolution com tratamento de erros e reintentos seguros.
- [x] Configurar a rota pública no backend; publicação final e troca da URL na Evolution dependem do botão Publish.
- [x] Construir painel administrativo autenticado para estado da instância e registros de conversas.
- [x] Adicionar observabilidade mínima para webhooks recebidos, falhas de processamento e envios.
- [x] Escrever testes Vitest para roteamento de instância, persistência, autenticação e falhas de integração.
- [x] Executar build, typecheck e testes automatizados; lint não disponível no scaffold porque o executável não está instalado.
- [x] Validar leitura e gravação no Supabase de destino.
- [x] Validar estado de conexão `open` da instância `financeiro` na Evolution.
- [x] Validar a rota de webhook com payload seguro não mutável; o fluxo real de mensagem depende da publicação pública.
- [x] Criar checkpoint da versão preparada para publicação, com limitações documentadas.
- [x] Entregar instruções de publicação e resumo de validações realizadas no encerramento.

## Histórico

- Migração autorizada pelo usuário em 29/08/2026.
- Instância Evolution confirmada: `financeiro`, número `558185436981`.
- Webhook Evolution existente: `https://museterabot-rlburgyg.manus.space/api/webhooks/evolution`.
- Registro `financeiro` já criado no Supabase `tvmffyfjdfwywsufjllv` como ativo, sujeito à integração do backend publicado.
- [x] Limitação autorizada: não migrar conversas, mensagens, estados e cobranças PIX históricas por falta de acesso ao Supabase de origem.
- [x] Concluir preparação da implantação para novos atendimentos no Supabase `tvmffyfjdfwywsufjllv`; ativação pública requer Publish.
- [x] Corrigir bug: mensagem enviada ao número `558185436981` não gerou resposta do bot publicado.
  - Causa (diagnóstico de 30/10/2026, verificado ao vivo): o webhook da Evolution apontava para a publicação antiga (`museterabot-rlburgyg.manus.space`) e o handler rejeitava com 401 qualquer webhook sem o `WEBHOOK_SHARED_TOKEN`, que a Evolution não envia por padrão.
  - Correção na branch `fix/webhook-evolution-auth`: o webhook passa a aceitar também a `apikey` que a Evolution envia no corpo (validada contra `EVOLUTION_API_KEY`), HMAC calculado sobre o corpo bruto, rota aceita o sufixo do modo "por eventos" e o log de rejeição mostra quais sinais de autenticação chegaram. Testes do webhook: 7/7 passando; typecheck limpo.
  - Para ativar em produção: publicar a correção e seguir `docs/webhook-evolution-setup.md` (apontar o webhook da instância `financeiro` para `botmusetera-nryykggd.manus.space`).
- [x] Atualizar preços dos planos: 30 dias R$ 69,90; 6 meses R$ 399,00; 12 meses R$ 699,00.
- [x] Validar textos, configuração do Mercado Pago, testes e build após a alteração; não foi criada cobrança real durante o teste.
- [x] Enviar todas as atualizações do projeto ao repositório GitHub conectado sem incluir segredos.
- [x] Atualizar valores: 30 dias R$ 69,90; 6 meses R$ 399,00; 12 meses R$ 699,00.
- [x] Remover links e referências de pagamento InfinitePay do fluxo de cartão.
- [x] Implementar checkout de cartão pelo Mercado Pago; confirmação/persistência do webhook permanece pendente para uma etapa dedicada.
- [x] Validar token Mercado Pago, preços, testes, typecheck, build e envio ao GitHub.
