---
scope_type: phase
related_phases: [2]
status: pending
date: 2026-08-30
scope_description: "Decisões técnicas de backend para o fluxo de cadastro, confirmação por e-mail, login/sessão, logout e recuperação de senha da Fase 02"
---

# Technical Decisions — Autenticação e Gerenciamento de Conta (Fase 02)

_Subprojects in scope:_

- `nestjs-backend/` — todas as TDs deste documento. É o único subprojeto existente no repositório.
- `next-frontend/` — **sem TD neste documento.** O diretório não existe e `docs/project-plan.md:39` registra que o Next.js "será criado depois, não agora". O bullet "Telas de cadastro, login, confirmação de conta e recuperação de senha" da Fase 02 fica descoberto aqui por decisão explícita do usuário (escopo somente backend); as decisões de contrato FE↔BE — transporte de token, formato de erro — serão pesquisadas na fase em que o frontend for criado.

**Estado de partida (verificado):** `nestjs-backend/src/` é o scaffold puro do NestJS 11.1.28 — cinco arquivos, `app.module.ts` com `imports: []`, `main.ts` sem `ValidationPipe`. Não há TypeORM, `@nestjs/config`, validação, `.env` nem entidades. O único elemento de banco que existe é o serviço `db` (PostgreSQL 17) em `nestjs-backend/compose.yaml`. A fundação de persistência e config é, portanto, **pré-requisito de execução** da Fase 02, não decisão — conforme escolha do usuário, este documento cobre apenas o que a autenticação exige diretamente.

**Decisões já resolvidas fora deste documento (não reabrir).** As skills e rules do projeto já fixam, com código canônico: `@nestjs/jwt` + `@nestjs/passport` para JWT com `issuer`/`audience` e access token curto; `class-validator` + `ValidationPipe` global; `@nestjs/config` + Joi com `isGlobal`; `@nestjs/throttler` para rate limiting; `TypeOrmModule.forRoot`/`forFeature` + `@InjectRepository`; `synchronize: false` e migrations via CLI; UUID como PK; `{ select: false }` em colunas sensíveis. Nenhum desses itens vira TD — são resolvidos por best-practices no momento da implementação.

---

## TD-01: Algoritmo de hash de senha

**Scope:** Backend

**Capability:** "Cadastro de usuário com e-mail e senha"

**Context:** É a única decisão de auth que nenhuma skill do projeto resolve. `security-auth-jwt.md` usa `bcrypt.hash` apenas para hash de refresh token, nunca para senha de usuário — não há escolha documentada. A decisão é de longo prazo: trocar o algoritmo depois exige re-hash na próxima autenticação bem-sucedida de cada usuário, com código de migração convivendo com dois formatos. Impacto de negócio: define o custo de um vazamento futuro da tabela `users` — com hash forte, senhas vazadas permanecem inúteis por muito tempo.

**Options:**

### Option A: argon2 (`argon2` 0.45.1, variante argon2id)
- Vencedor da Password Hashing Competition e recomendação primária do OWASP Password Storage Cheat Sheet. `argon2id` resiste a ataques de GPU/ASIC por ser memory-hard, algo que bcrypt não oferece. Parâmetros OWASP: 19 MiB de memória, `timeCost` 2, `parallelism` 1.
- **Pros:** melhor resistência a cracking por hardware dedicado; baseline recomendado pelo OWASP ASVS; parâmetros ajustáveis em três dimensões (memória, tempo, paralelismo).
- **Cons:** módulo nativo (`node-gyp-build` + `node-addon-api`) — exige toolchain de compilação na imagem Docker; consumo de memória por hash precisa ser dimensionado contra a concorrência do container.

### Option B: bcrypt (`bcrypt` 6.0.0, cost ≥ 12)
- Algoritmo consolidado há mais de duas décadas, ainda aceito pelo OWASP como alternativa válida quando argon2 não é viável. Limite de 72 bytes na entrada exige atenção (senhas longas são truncadas silenciosamente).
- **Pros:** maturidade e ubiquidade; ecossistema NestJS majoritariamente escrito em torno dele; menor consumo de memória por operação.
- **Cons:** não é memory-hard — GPUs modernas atacam bcrypt com eficiência muito maior que argon2id; truncamento em 72 bytes é uma armadilha silenciosa que precisa de validação de tamanho no DTO; também é módulo nativo.

### Option C: `@node-rs/argon2` 2.2.0 (binding Rust, prebuilt)
- Mesma função argon2id, implementada em Rust com binários pré-compilados por plataforma — dispensa toolchain de compilação no build.
- **Pros:** segurança idêntica à Option A sem custo de `node-gyp` na imagem; instalação mais rápida e previsível em CI.
- **Cons:** ecossistema menor e menos exemplos em contexto NestJS; depende de haver prebuilt para a plataforma-alvo (`node:25.6.0-slim`, linux/arm64 no Apple Silicon) — se faltar, o fallback é compilar mesmo assim.

**Recommendation:** Option A (`argon2` com argon2id) — é o baseline do OWASP ASVS, que o projeto adota como referência, e o `Dockerfile.dev` já instala pacotes via `apt` (a toolchain é um ajuste pequeno e único). A Option C é a alternativa preferencial caso o tempo de build do container se mostre um incômodo real: a troca é de biblioteca, não de algoritmo, e não afeta o formato PHC do hash armazenado.

**Decision:** A (`argon2` com argon2id)

---

## TD-02: Estratégia de sessão e ciclo de vida dos tokens

**Scope:** Backend

**Capability:** Transversal — covers: "Login e controle de sessão do usuário", "Logout"

**Context:** As skills fixam o mecanismo (JWT via `@nestjs/jwt`, access token de 15 min, refresh token com hash no banco), mas não a **política de sessão** — e é ela que decide se "Logout" é realmente implementável. Com JWT puro e stateless, um access token permanece válido até expirar mesmo após o logout: o servidor não tem como revogá-lo. Essa é a tensão central da fase, e nenhuma skill a resolve. Decisão dependente: TD-03 (rotação) só faz sentido sob as Options B ou C.

**Options:**

### Option A: Stateless puro (apenas access token JWT)
- O servidor não guarda estado de sessão; o logout é uma operação apenas do cliente, que descarta o token.
- **Pros:** implementação mínima; nenhuma consulta ao banco na validação do token.
- **Cons:** **logout não é efetivo** — um token roubado continua válido até expirar. Falha o bullet "Logout" da fase em qualquer leitura de segurança séria; sem refresh token, a sessão expira em 15 min e obriga re-login constante.

### Option B: Access token stateless + refresh token persistido (híbrido)
- Access token JWT curto e auto-contido (15 min, sem consulta ao banco); refresh token opaco de alta entropia, guardado com hash em tabela própria e com expiração longa (7 dias). Logout apaga/revoga a linha do refresh token.
- **Pros:** logout revoga a sessão de forma real na renovação; validação do access token permanece barata; é exatamente o desenho que `security-auth-jwt.md` já demonstra, reduzindo atrito de implementação; usa só PostgreSQL, sem Redis — coerente com a stack atual, onde a fila ainda é "TBD".
- **Cons:** janela residual de até 15 min em que o access token revogado ainda passa; exige uma tabela e um índice a mais.

### Option C: Stateful completo (sessão consultada no banco a cada requisição)
- Cada requisição autenticada verifica a sessão no banco; a revogação é imediata.
- **Pros:** revogação instantânea, sem janela residual; controle fino de sessões ativas por usuário.
- **Cons:** uma consulta ao banco por requisição autenticada — custo que cresce com o tráfego de leitura previsto para uma plataforma de vídeo; anula a principal vantagem do JWT e joga carga sobre o mesmo PostgreSQL que servirá o catálogo.

**Recommendation:** Option B — entrega um logout efetivo (requisito literal da fase) sem impor consulta ao banco por requisição, e é o padrão que as skills do projeto já documentam com código. A janela de 15 min é aceitável para o perfil de risco do StreamTube (não há dados financeiros); se algum endpoint sensível surgir depois, ele pode validar contra a sessão sob demanda sem mudar a arquitetura.

**Decision:** B (híbrido)

---

## TD-03: Política de rotação e revogação do refresh token

**Scope:** Backend

**Capability:** "Login e controle de sessão do usuário"

**Context:** Decidida a Option B da TD-02, resta definir o comportamento do refresh token no `POST /auth/refresh` — ponto que `security-auth-jwt.md` deixa em aberto (mostra a criação, não a política). É o que determina se o roubo de um refresh token é detectável. Depende de TD-02.

**Options:**

### Option A: Refresh token de longa duração, sem rotação
- O mesmo refresh token é reutilizado até expirar.
- **Pros:** implementação trivial; menos escritas no banco.
- **Cons:** um token vazado dá ao atacante 7 dias de acesso silencioso, sem qualquer sinal de comprometimento. Contraria a RFC 9700 (Best Current Practice para OAuth 2.0), que orienta rotação ou sender-constraining.

### Option B: Rotação simples (novo refresh token a cada uso, o anterior é invalidado)
- Cada renovação emite um par novo e invalida o refresh anterior.
- **Pros:** encurta drasticamente a janela útil de um token vazado; alinhado à RFC 9700; custo de implementação baixo.
- **Cons:** sozinha, não *detecta* o roubo — se o atacante usar o token antes da vítima, a vítima apenas falha na renovação seguinte, sem que o sistema saiba por quê.

### Option C: Rotação com detecção de reuso (token family / reuse detection)
- Como a Option B, mas cada linhagem de tokens carrega um identificador de família. Se um token já rotacionado for reapresentado, é sinal de vazamento e **toda a família é revogada**, derrubando as sessões daquela linhagem.
- **Pros:** transforma o roubo em evento detectável e contido automaticamente; é a recomendação explícita da RFC 9700 para clientes públicos; o custo extra sobre a Option B é uma coluna de família e uma verificação.
- **Cons:** exige guardar tokens rotacionados por uma janela (em vez de apagar na hora) e uma rotina de limpeza; falsos positivos possíveis em corrida de requisições concorrentes do próprio cliente legítimo — mitigável com uma pequena janela de tolerância.

**Recommendation:** Option C — o delta sobre a Option B é pequeno (uma coluna `family_id` e uma verificação no refresh) e é o que converte rotação em detecção real de comprometimento, conforme RFC 9700. Como não há Redis na stack, a limpeza dos tokens expirados fica como tarefa agendada no próprio PostgreSQL.

**Decision:** C

---

## TD-04: Biblioteca e camada de envio de e-mails transacionais

**Scope:** Backend

**Capability:** "Serviço de envio de e-mails transacionais"

**Context:** `docs/diagrams/software-arch.mermaid` fixa o transporte (SMTP, sistema externo), mas não a biblioteca nem a estratégia de templates. Nenhuma skill do projeto cobre e-mail. `nestjs-backend/CLAUDE.md` já antecipa o resultado ao citar `mail.config.ts`, `MAIL_FROM` e templates `.hbs` que precisam entrar em `nest-cli.json` sob `compilerOptions.assets` — sinal de que Handlebars é o caminho esperado, mas a escolha ainda não está registrada como decisão.

**Options:**

### Option A: `@nestjs-modules/mailer` 2.3.7 (sobre nodemailer) com Handlebars
- Módulo NestJS que embrulha o nodemailer e integra template engine, injeção de dependência e configuração assíncrona via `ConfigModule`.
- **Pros:** `MailerModule.forRootAsync` encaixa direto no padrão `ConfigModule` já adotado; renderização de template embutida, sem código próprio de glue; **os template engines são peer dependencies opcionais** (verificado: apenas `handlebars` entra, não mjml/pug/nunjucks/bullmq); alinha com o `mail.config.ts` e os `.hbs` já previstos no `CLAUDE.md`.
- **Cons:** uma camada de abstração a mais sobre o nodemailer; a versão acompanha o ritmo do mantenedor, não o do NestJS.

### Option B: `nodemailer` 9.0.6 direto, com serviço próprio
- Um `MailService` próprio encapsula o transporter do nodemailer, e a renderização de template é escrita à mão.
- **Pros:** dependência única e controle total do ciclo de envio; sem intermediário para acompanhar em upgrades.
- **Cons:** exige escrever e testar a glue de template, cache de compilação e configuração — trabalho que a Option A já entrega pronto; tende a reimplementar mal aquilo que o módulo faz bem.

**Recommendation:** Option A — encaixa no padrão de configuração assíncrona que o projeto já usa e evita glue caseira, e a objeção de peso da dependência não se sustenta (todos os engines alternativos são peers opcionais). Para desenvolvimento, o transporte SMTP deve apontar para um servidor de captura local (MailHog ou Mailpit como serviço no `compose.yaml`), nunca para um provedor real — o `CLAUDE.md` do backend já trata "mail" como serviço de infraestrutura esperado.

**Decision:** A (nodemailer)

---

## TD-05: Formato e ciclo de vida dos tokens de confirmação de conta e de reset de senha

**Scope:** Backend

**Capability:** Transversal — covers: "Confirmação de conta via e-mail com link de ativação", "Recuperação de senha: solicitação via e-mail → link com token → redefinição"

**Context:** Os dois fluxos por e-mail precisam de um token que viaja em URL. Nenhuma skill decide o formato, e a escolha tem consequências de segurança diretas: tokens em URL vazam por histórico de navegador, `Referer` e logs de servidor. Também define se um link de reset pode ser reutilizado — um dos vetores de account takeover mais explorados. Nota: o link em si é consumido pelo frontend, mas como não há frontend nesta fase, o que se decide aqui é o formato produzido pela API; o contrato de rota fica para a fase do Next.js.

**Options:**

### Option A: JWT assinado, sem persistência
- O token carrega `sub`, propósito e expiração, validado apenas pela assinatura.
- **Pros:** nenhuma tabela nova; validação sem consulta ao banco.
- **Cons:** **não é revogável** — um link de reset vazado permanece válido até expirar, e não há como invalidá-lo após o uso. Permite reutilizar o mesmo link para redefinir a senha múltiplas vezes. Inaceitável para reset de senha.

### Option B: Token opaco aleatório, com hash persistido, uso único
- 32 bytes de `crypto.randomBytes`, entregues em claro apenas no link; no banco guarda-se apenas o hash (SHA-256), com `expiresAt` e `usedAt`. O consumo marca o token como usado.
- **Pros:** revogável e de uso único — fecha o vetor de reutilização; vazamento do banco não expõe tokens utilizáveis (só hashes); permite expirações distintas por finalidade (ativação longa, reset curto); é o padrão do OWASP para reset de senha.
- **Cons:** exige tabela, índice e rotina de limpeza; uma consulta ao banco por validação — irrelevante na frequência desses fluxos.

### Option C: Token opaco com HMAC, sem persistência
- Token derivado por HMAC de dados do usuário (incluindo o hash atual da senha), sem armazenamento.
- **Pros:** sem tabela; invalida-se sozinho quando a senha muda.
- **Cons:** não expira de forma independente nem suporta revogação explícita; a lógica de derivação é sutil e fácil de errar — um erro aqui é uma falha crítica de autenticação.

**Recommendation:** Option B — é a única que entrega uso único e revogabilidade, requisitos não negociáveis para reset de senha (OWASP ASVS). Complementos que decorrem da escolha e devem valer na implementação: expiração curta para reset (1 h) e mais longa para ativação (24 h); invalidar todas as sessões ativas do usuário após a redefinição; e responder à solicitação de reset sempre com a mesma mensagem genérica, existindo ou não a conta, para não transformar o endpoint em oráculo de enumeração de e-mails. O rate limiting desses endpoints já está resolvido por `security-rate-limiting.md` (`@nestjs/throttler`) e não é decisão.

**Decision:** B (hash persistido)

---

## TD-06: Consistência entre criação de usuário e criação do canal

**Scope:** Backend

**Capability:** "Criação automática do canal do usuário a partir do prefixo do e-mail"

**Context:** O cadastro precisa criar duas entidades de domínios diferentes — `User` e `Channel` — e a entrega da fase exige "Canal criado automaticamente para cada usuário". Sem uma política explícita, uma falha no meio deixa usuário órfão sem canal, estado que quebra todas as fases seguintes (upload, página do canal). Há uma tensão real com o princípio de Single Responsibility do `CLAUDE.md`: o `UsersService` não deveria criar entidades de outro domínio. Um segundo ponto: o prefixo do e-mail não é único (`joao@a.com` e `joao@b.com` colidem), então a geração do identificador do canal precisa de política de desambiguação.

**Options:**

### Option A: Transação única no serviço de cadastro
- Um `dataSource.transaction` engloba a criação do usuário e a do canal; qualquer falha desfaz tudo.
- **Pros:** atomicidade garantida pelo banco, sem estado intermediário inválido; `tx-use-transactions.md` e `nestjs-testing.md` já documentam o padrão e como testá-lo.
- **Cons:** acopla os dois domínios no mesmo fluxo síncrono — precisa de cuidado para não colocar a lógica de canal dentro do `UsersService`.

### Option B: Evento de domínio (`user.registered`) consumido pelo módulo de canais
- O cadastro emite um evento; o `ChannelsModule` reage criando o canal.
- **Pros:** desacoplamento limpo entre os módulos, alinhado a `arch-use-events`.
- **Cons:** sem atomicidade — se o handler falhar, resta usuário sem canal, exatamente o estado que a entrega proíbe; com `@nestjs/event-emitter` em processo, não há retry nem garantia de entrega. Consistência eventual sem infraestrutura que a suporte (a fila ainda é "TBD" no projeto).

### Option C: Criação em transação com compensação explícita
- Cria o usuário, depois o canal; em caso de falha, executa a compensação apagando o usuário.
- **Pros:** `nestjs-testing.md` descreve exatamente esse cenário de teste de compensação.
- **Cons:** reimplementa manualmente o que o banco já faz com transação; a própria compensação pode falhar, deixando o estado inconsistente mesmo assim.

**Recommendation:** Option A — a entrega da fase exige a garantia de que todo usuário tem canal, e transação é a forma mais simples e confiável de assegurar isso com PostgreSQL já na stack. Para respeitar o Single Responsibility, a orquestração deve ficar num serviço de registro (`AuthService`/`RegistrationService`) que chama `UsersService` e `ChannelsService` dentro do mesmo `EntityManager`, em vez de o `UsersService` criar canais. Sobre a colisão de prefixos: definir na implementação uma política determinística de desambiguação (sufixo numérico incremental) com `unique: true` na coluna, tratando a violação de unicidade como caso esperado, não como erro.

**Decision:** A (Transação unica)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Algoritmo de hash de senha | Option A — `argon2` (argon2id) | A |
| TD-02 | Backend | Estratégia de sessão e ciclo de vida dos tokens | Option B — access stateless + refresh persistido | B |
| TD-03 | Backend | Política de rotação e revogação do refresh token | Option C — rotação com detecção de reuso | C |
| TD-04 | Backend | Biblioteca e camada de envio de e-mails | Option A — `@nestjs-modules/mailer` + Handlebars | A |
| TD-05 | Backend | Tokens de confirmação de conta e reset de senha | Option B — token opaco, hash persistido, uso único | B |
| TD-06 | Backend | Consistência entre criação de usuário e canal | Option A — transação única orquestrada | A |

## Notas de escopo

Itens levantados durante a pesquisa que **não** viraram TD, registrados para não se perderem:

- **Bullet de telas (frontend) descoberto.** "Telas de cadastro, login, confirmação de conta e recuperação de senha" não tem TD aqui, por decisão de escopo. As decisões de contrato FE↔BE — transporte do token (cookie httpOnly vs header `Authorization`), envelope de erro da API e formato da rota do link de ativação — precisam ser decididas antes ou junto da criação do `next-frontend/`. Enquanto isso, a API de auth será construída sem consumidor definido; vale manter o transporte de token isolado numa camada fina para reduzir o retrabalho.
- **Fundação de persistência e bootstrap.** TypeORM, `@nestjs/config` + Joi, `.env`/`.env.example`, `ValidationPipe` global, `helmet`, CORS e filtro de exceção não são decisões (as skills já os resolvem), mas **não existem no código** e são pré-requisito de execução da Fase 02. Um ponto merece escolha consciente na implementação: o `latest` do TypeORM hoje é **1.1.0**, com a linha 0.3.x marcada como `legacy` — `@nestjs/typeorm` 12.0.1 aceita `^0.3.0 || ^1.0.0-dev`, mas as rules do projeto foram escritas contra a API 0.3.
- **Ajustes de configuração pendentes** que a Fase 02 vai encontrar: `package.json` precisa de `setupFiles: ["dotenv/config"]` e `testRegex` cobrindo `integration-spec`; `nest-cli.json` precisa de `compilerOptions.assets` para os templates `.hbs`; a branch `dev` exigida pelo Git Flow do `CLAUDE.md` ainda não existe.
- **Rules com escopo inativo.** Todos os `paths:` em `.claude/rules/*.md` apontam para `nestjs-project/**`, mas o diretório real é `nestjs-backend/` — as nove rules não casam com arquivo nenhum hoje. Além disso, `.claude/rules/typeorm-migrations.md` proíbe `synchronize: true` em qualquer ambiente enquanto a skill `typeorm` o permite em desenvolvimento; a rule do projeto é a mais restritiva e deve prevalecer.
- **Correção de segurança na skill.** `typeorm/rules/config-datasource-setup.md` sugere `ssl: { rejectUnauthorized: false }` em produção, o que desativa a validação da cadeia de certificados e abre espaço para MITM na conexão com o banco. Ao chegar em produção, usar `rejectUnauthorized: true` com bundle `ca` explícito.
