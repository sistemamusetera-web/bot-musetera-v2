# Projeto TODO

- [x] Auditar o código atual; o inventário confirmou que os dados históricos exigem acesso service_role de origem, indisponível.
- [x] Confirmar o esquema efetivo do Supabase de destino `tvmffyfjdfwywsufjllv` e documentar diferenças.
- [x] Recriar no novo Supabase todas as tabelas, tipos, índices, funções e políticas necessárias ao bot.
- [ ] Migrar conversas operacionais existentes sem duplicação e sem apagar dados do destino.
- [ ] Migrar mensagens operacionais existentes sem duplicação e preservando vínculos com conversas.
- [ ] Migrar estados do bot e registros de cobranças PIX existentes com validação de contagens e integridade.
- [ ] Configurar o backend para usar exclusivamente o novo Supabase.
- [x] Garantir que chaves de serviço e segredos permaneçam somente em variáveis de ambiente do servidor.
- [x] Implementar validação de assinatura/autorização dos webhooks da Evolution.
- [x] Identificar a instância remetente em cada webhook e roteá-la corretamente.
- [x] Processar mensagens recebidas pela instância `financeiro` no número `558185436981`.
- [x] Manter `financeiro` ativa no cadastro de instâncias autorizadas.
- [ ] Preservar o mesmo fluxo de atendimento financeiro do número anterior.
- [x] Implementar envio de mensagens pela Evolution com tratamento de erros e reintentos seguros.
- [ ] Configurar a rota pública de webhook no backend publicado.
- [x] Construir painel administrativo autenticado para estado da instância e registros de conversas.
- [x] Adicionar observabilidade mínima para webhooks recebidos, falhas de processamento e envios.
- [x] Escrever testes Vitest para roteamento de instância, persistência, autenticação e falhas de integração.
- [x] Executar build, typecheck e testes automatizados; lint não disponível no scaffold porque o executável não está instalado.
- [x] Validar leitura e gravação no Supabase de destino.
- [x] Validar estado de conexão `open` da instância `financeiro` na Evolution.
- [x] Validar a rota de webhook com payload seguro não mutável; o fluxo real de mensagem depende da publicação pública.
- [ ] Criar checkpoint da versão preparada para publicação, com limitações documentadas.
- [ ] Entregar instruções de publicação e resumo de validações realizadas.

## Histórico

- Migração autorizada pelo usuário em 29/08/2026.
- Instância Evolution confirmada: `financeiro`, número `558185436981`.
- Webhook Evolution existente: `https://museterabot-rlburgyg.manus.space/api/webhooks/evolution`.
- Registro `financeiro` já criado no Supabase `tvmffyfjdfwywsufjllv` como ativo, sujeito à integração do backend publicado.
- [x] Limitação autorizada: não migrar conversas, mensagens, estados e cobranças PIX históricas por falta de acesso ao Supabase de origem.
- [ ] Concluir implantação apenas para novos atendimentos no Supabase `tvmffyfjdfwywsufjllv`.
