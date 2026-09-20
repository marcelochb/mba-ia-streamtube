# Phase 01 — Configuração Base do Projeto

## Objective

Entregar a fundação executável do projeto: monorepo com Git Flow, ambiente de desenvolvimento local completo via Docker Compose, configuração validada por schema, PostgreSQL com pipeline de migrations exercitado (sem tabelas de domínio), bootstrap de segurança da API e a fundação de IA para coding corrigida e ativa.

---

## Step Implementations

### SI-01.1 — Git Flow e estrutura do monorepo

**Description:** Estabelece as duas branches de longa duração exigidas pelo `CLAUDE.md` e documenta a estrutura do monorepo, incluindo o espaço reservado para o `next-frontend/`.

**Technical actions:**

- Criar a branch `dev` a partir de `main` e publicá-la no remoto como branch de integração; `main` permanece estável e não recebe commit direto.
- Documentar no `README.md` da raiz a estrutura do monorepo (`nestjs-backend/`, `docs/`, e `next-frontend/` como ainda não inicializado) e o fluxo de branches `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*` partindo de `dev` e retornando para `dev`.
- Corrigir os links quebrados para o diagrama de arquitetura: `CLAUDE.md` e `docs/project-plan.md` apontam para `docs/diagrams/software-arch.mermaid`, mas o arquivo está em `docs/software-arch.mermaid` — mover o arquivo para `docs/diagrams/` para casar com a referência documentada.

**Dependencies:** None

**Acceptance criteria:**

- `git branch -a` lista `main` e `dev`, com `dev` presente também no remoto.
- O caminho referenciado em `CLAUDE.md` para o diagrama de arquitetura resolve para um arquivo existente — nenhum link do repositório aponta para caminho inexistente.
- O `README.md` da raiz descreve os três diretórios do monorepo e o fluxo de branches.

---

### SI-01.2 — Configuração de ambiente com validação por schema

**Description:** Introduz o arquivo de variáveis de ambiente e o `@nestjs/config` global com validação Joi na inicialização, para que a aplicação falhe imediatamente quando uma variável obrigatória estiver ausente ou malformada.

**Technical actions:**

- Instalar `@nestjs/config@^12.0.0` e `joi@^18.2.8` (compatíveis com NestJS 11).
- Criar `.env.example` versionado com todas as chaves necessárias (`NODE_ENV`, `PORT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `CORS_ORIGIN`) sem valores sensíveis, e `.env` local a partir dele — `.env` já está coberto pelo `.gitignore` da raiz e não deve ser versionado. Usar `DB_HOST=db` (nome do serviço no Compose), nunca `localhost`.
- Criar o schema de validação Joi marcando como `required()` toda variável sem default seguro, com `NODE_ENV` restrito a `development|test|production` e `PORT`/`DB_PORT` como `number` com default.
- Registrar `ConfigModule.forRoot({ isGlobal: true, validationSchema, validationOptions: { libraryOptions: { abortEarly: false, allowUnknown: true } } })` no `AppModule`. **Atenção:** a partir do `joi@18` as opções da biblioteca precisam estar aninhadas em `validationOptions.libraryOptions`; a forma plana usada em `.claude/skills/nestjs-best-practices/rules/devops-use-config-module.md` é ignorada silenciosamente nesta versão.
- Expor a configuração em namespaces tipados com `registerAs` (`database`, `app`) e consumi-los via `ConfigType`, evitando `process.env` espalhado pelo código.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/config/validation-schema.spec.ts | Unit | schema aceita env completo; rejeita variável obrigatória ausente, `NODE_ENV` inválido e porta não numérica |

**Dependencies:** None

**Acceptance criteria:**

- Iniciar a aplicação sem uma variável obrigatória (ex.: `DB_PASSWORD`) aborta o boot com erro que nomeia a variável faltante, em vez de subir e falhar depois na conexão.
- Iniciar a aplicação com `NODE_ENV` fora de `development|test|production` aborta o boot com erro de validação.
- Com todas as variáveis presentes e válidas, a aplicação inicializa e responde em `PORT`.
- Um `.env` ausente de uma variável obrigatória produz erro listando **todas** as variáveis inválidas de uma vez, não apenas a primeira.
- `.env.example` está versionado e `.env` não aparece em `git status` nem em `git ls-files`.

---

### SI-01.3 — Docker Compose com credenciais externalizadas e persistência

**Description:** Ajusta o `compose.yaml` para ler credenciais do `.env` em vez de tê-las hardcoded e adiciona volume nomeado ao PostgreSQL, para que o banco sobreviva a `docker compose down`.

**Technical actions:**

- Substituir os valores hardcoded de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` no serviço `db` por interpolação das variáveis do `.env` (`${DB_USERNAME}`, `${DB_PASSWORD}`, `${DB_NAME}`), garantindo que Compose e aplicação leiam a mesma fonte.
- Adicionar volume nomeado (ex.: `pgdata:/var/lib/postgresql/data`) ao serviço `db` e declará-lo no bloco `volumes:` de topo.
- Encaminhar o `.env` ao serviço `nestjs-api` via `env_file`, mantendo o `healthcheck` do `db` com `pg_isready -U ${DB_USERNAME}` e o `depends_on: condition: service_healthy` já existentes.
- Manter no Compose apenas `db` e `nestjs-api` — os serviços de e-mail (Fase 02), object storage e fila (Fase 03) serão adicionados por suas próprias fases.
- Documentar no `README.md` do `nestjs-backend` que a instalação de dependências (`docker compose exec nestjs-api npm install`) é passo manual de primeira execução, já que o `Dockerfile.dev` usa `CMD tail -f /dev/null` e não instala nada no build.

**Dependencies:** SI-01.2

**Acceptance criteria:**

- `docker compose up -d` sobe `db` e `nestjs-api` e `docker compose ps` mostra ambos com status `running`.
- `docker compose exec db pg_isready -U <DB_USERNAME>` responde `accepting connections`.
- Nenhuma credencial literal permanece no `compose.yaml` — todos os valores de usuário, senha e nome do banco vêm do `.env`.
- Dados gravados no banco sobrevivem a um ciclo `docker compose down` seguido de `docker compose up -d`.
- O Compose não declara nenhum serviço além de `db` e `nestjs-api`.

---

### SI-01.4 — Integração do TypeORM e DataSource

**Description:** Conecta a aplicação ao PostgreSQL via TypeORM, com opções vindas do `ConfigService` e `synchronize` desativado em todos os ambientes.

**Technical actions:**

- Instalar `typeorm@^0.3.31` e `@nestjs/typeorm@^12.0.1` — fixar deliberadamente a linha `0.3.x`: `@nestjs/typeorm@12.0.1` aceita `^0.3.0 || ^1.0.0-dev`, mas todas as rules de `.claude/skills/typeorm/` foram escritas contra a API `0.3`. Instalar também `pg@^8.13.0` como driver.
- Registrar `TypeOrmModule.forRootAsync({ inject: [databaseConfig.KEY], useFactory })` no `AppModule`, montando as opções a partir do namespace de configuração da SI-01.2.
- Definir `synchronize: false` **fixo, sem condicional de ambiente**. A rule `.claude/rules/typeorm-migrations.md` proíbe `synchronize: true` em qualquer ambiente e prevalece sobre a skill `typeorm` e sobre os exemplos da documentação oficial do `@nestjs/typeorm`, que usam `synchronize: isDev`.
- Criar `src/data-source.ts` exportando uma instância de `DataSource` para a CLI do TypeORM, reaproveitando as mesmas variáveis de ambiente, com `migrations` apontando para o diretório de migrations e `migrationsTableName` explícito.
- Configurar `logging` apenas em desenvolvimento e `poolSize` explícito. Para `ssl` em produção, usar `rejectUnauthorized: true` com bundle `ca` — **não** replicar o `rejectUnauthorized: false` que aparece tanto na documentação oficial quanto em `config-datasource-setup.md`, pois desativa a validação da cadeia de certificados e abre espaço para MITM na conexão com o banco.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/database/data-source.integration-spec.ts | Integration | DataSource conecta ao serviço `db`, executa query trivial e reporta `synchronize: false` nas opções efetivas |

**Dependencies:** SI-01.2, SI-01.3, SI-01.7

**Acceptance criteria:**

- A aplicação inicializa conectada ao PostgreSQL e encerra sem erro de conexão pendente.
- Uma consulta trivial (`SELECT 1`) executada pelo `DataSource` da aplicação retorna resultado a partir de dentro do container.
- As opções efetivas do `DataSource` reportam `synchronize: false` mesmo com `NODE_ENV=development`.
- Subir a aplicação com `DB_HOST` inválido falha com erro de conexão explícito, sem deixar o processo pendurado indefinidamente.

---

### SI-01.5 — Pipeline de migrations e migration baseline

**Description:** Estabelece o ciclo completo de migrations e o valida com uma migration baseline que habilita extensões do PostgreSQL, sem criar nenhuma tabela de domínio.

**Technical actions:**

- Adicionar ao `package.json` o script `typeorm` (via `ts-node` com o `tsconfig` do projeto) e os scripts `migration:generate`, `migration:run`, `migration:revert` e `migration:show`, todos passando `-d src/data-source.ts` conforme a CLI do TypeORM 0.3 (`typeorm migration:run -- -d <path>`).
- Criar a migration baseline com `migration:create` (não `generate`, que compara entidades e produziria arquivo vazio por não haver nenhuma), habilitando no `up` a extensão `pgcrypto` — necessária para `gen_random_uuid()`, já que o padrão de PK do projeto é UUID.
- Implementar o `down` da migration baseline removendo a extensão, para que o ciclo `run`/`revert` seja reversível de verdade.
- Declarar em `nest-cli.json` a opção `compilerOptions.assets` com `watchAssets: true`, para que arquivos não-TypeScript necessários em runtime sejam copiados para `dist/` — `tsc` só emite `.ts`.
- Não criar seeds nesta fase: sem tabelas de domínio não há dado a semear; a infraestrutura de seeds será introduzida pela fase que criar as primeiras entidades.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/migrations/baseline.integration-spec.ts | Integration | após `migration:run` a extensão `pgcrypto` está habilitada e `gen_random_uuid()` retorna UUID válido |

**Dependencies:** SI-01.4

**Acceptance criteria:**

- `migration:run` em banco limpo aplica a migration baseline e cria a tabela de controle de migrations.
- `migration:show` lista a migration baseline como aplicada após o `run`.
- `SELECT gen_random_uuid()` executa com sucesso no banco após a migration, retornando um UUID válido.
- `migration:revert` desfaz a migration baseline e `migration:show` volta a listá-la como pendente.
- Executar `migration:run` duas vezes em sequência não reaplica a migration nem gera erro — a segunda execução reporta que não há migrations pendentes.

---

### SI-01.6 — Bootstrap de segurança e tratamento global de erros

**Description:** Configura no `main.ts` as defesas de borda da API — validação de input, headers de segurança, CORS restritivo, filtro global de exceções e encerramento gracioso.

**Technical actions:**

- Instalar `helmet@^8.3.0` e `class-validator@^0.14.0` + `class-transformer@^0.5.1`, e registrar `app.use(helmet())` antes de qualquer rota.
- Registrar `ValidationPipe` global com `whitelist: true`, `forbidNonWhitelisted: true` e `transform: true`, para que propriedades não declaradas em DTO sejam rejeitadas em vez de trafegarem até a camada de serviço.
- Configurar CORS restritivo lendo a origem permitida da configuração (`CORS_ORIGIN`) — nunca `*`, conforme baseline de segurança do projeto.
- Implementar filtro de exceção global que normaliza toda resposta de erro no formato `{ statusCode, error, message }` definido no Error Catalog, sem expor `stack trace` ao cliente e sem registrar PII, senhas ou tokens em log.
- Habilitar `app.enableShutdownHooks()` para que sinais `SIGTERM`/`SIGINT` fechem as conexões do pool antes do processo terminar.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| src/common/filters/all-exceptions.filter.spec.ts | Unit | normalização do corpo de erro; ausência de `stack` na resposta |
| test/bootstrap.e2e-spec.ts | E2E | headers do helmet presentes; body com propriedade não declarada retorna 400; rota inexistente retorna 404 no formato do catálogo |

**Dependencies:** SI-01.2

**Acceptance criteria:**

- Uma requisição a rota inexistente retorna 404 com corpo no formato `{ statusCode, error, message }`.
- Uma requisição com propriedade não declarada no DTO retorna 400 com a lista de mensagens de validação.
- Toda resposta inclui os headers de segurança do helmet (ex.: `X-Content-Type-Options: nosniff`) e não inclui `X-Powered-By`.
- Uma requisição de origem não autorizada não recebe `Access-Control-Allow-Origin` permissivo — a resposta nunca traz `*`.
- Uma exceção não tratada retorna 500 no formato do catálogo **sem** `stack trace` no corpo da resposta.
- Enviar `SIGTERM` ao processo encerra a aplicação fechando as conexões do pool, sem erro de conexão pendente.

---

### SI-01.7 — Configuração do Jest para as três camadas de teste

**Description:** Ajusta a configuração do Jest para carregar o `.env` no processo de teste e reconhecer o sufixo de integração, sem o que nenhum teste de banco funciona dentro do container.

**Technical actions:**

- Adicionar `setupFiles: ["dotenv/config"]` à configuração Jest do `package.json` e ao `test/jest-e2e.json`. Sem isso o `.env` não é carregado no processo do Jest e `DB_HOST` fica indefinido ou cai para `localhost`, quebrando a resolução DNS entre containers.
- Alterar o `testRegex` do `package.json` de `.*\.spec\.ts$` para `.*\.(spec|integration-spec)\.ts$`, cobrindo unit e integração; manter o `testRegex` do `test/jest-e2e.json` restrito a `.e2e-spec.ts$`.
- Instalar `dotenv@^17.0.0` como devDependency, já que passa a ser carregado explicitamente pelo Jest.
- Adicionar script de teste de integração que force `--runInBand`, pois integração e e2e compartilham o mesmo banco e a execução paralela causa violação de FK, deadlock e contaminação entre suítes.
- Não introduzir novos sufixos de teste além de `spec`, `integration-spec` e `e2e-spec`.

**Dependencies:** SI-01.2

**Acceptance criteria:**

- A suíte unitária executa e um teste que leia `process.env.DB_HOST` dentro do container obtém `db`, não `localhost` nem `undefined`.
- Um arquivo `*.integration-spec.ts` é coletado e executado pelo comando de teste padrão — antes da mudança ele era ignorado pelo `testRegex`.
- Um arquivo `*.e2e-spec.ts` é coletado apenas pelo comando de e2e e não pela suíte unitária.
- A suíte completa executa com `--runInBand` sem erro de contaminação entre suítes.

---

### SI-01.8 — Fundação de IA para coding

**Description:** Corrige os defeitos que hoje impedem as rules do projeto de vigorar e alinha as skills com as versões efetivamente instaladas, para que as fases seguintes sejam implementadas com orientação ativa e correta.

**Technical actions:**

- Corrigir o `paths:` das nove rules em `.claude/rules/*.md`, trocando o glob `nestjs-project/**` por `nestjs-backend/**` — hoje nenhuma das rules casa com arquivo algum, pois o diretório real é `nestjs-backend/`. Corrigir também a coluna de localização da tabela "Test Type Selection" em `nestjs-backend/CLAUDE.md`, que repete o caminho errado.
- Corrigir `.claude/skills/nestjs-best-practices/rules/devops-use-config-module.md`: as opções `abortEarly`/`allowUnknown` precisam estar aninhadas em `validationOptions.libraryOptions` a partir do `joi@18`; a forma plana documentada na skill é silenciosamente ignorada na versão instalada.
- Corrigir `.claude/skills/typeorm/rules/config-datasource-setup.md`, substituindo `ssl: { rejectUnauthorized: false }` por `rejectUnauthorized: true` com bundle `ca` explícito — a forma atual desativa a validação da cadeia de certificados e habilita MITM na conexão com o banco.
- Alinhar `.claude/skills/typeorm/rules/migration-workflow.md` com a rule `.claude/rules/typeorm-migrations.md`, deixando explícito que `synchronize` é `false` em todos os ambientes neste projeto e que a rule prevalece sobre o exemplo canônico da skill.
- Registrar no `README.md` da raiz que o projeto fixa `typeorm@0.3.x` deliberadamente (dist-tag `legacy`) porque as rules da skill foram escritas contra essa API, junto do critério para uma futura migração para a linha `1.x`.

**Dependencies:** None

**Acceptance criteria:**

- Todo `paths:` de `.claude/rules/*.md` casa com pelo menos um arquivo existente no repositório — nenhuma rule fica inerte.
- Nenhum arquivo em `.claude/skills/` recomenda `ssl: { rejectUnauthorized: false }`.
- Nenhum arquivo em `.claude/skills/` ou `.claude/rules/` apresenta as opções do Joi na forma plana incompatível com a versão instalada.
- A orientação sobre `synchronize` é idêntica em `.claude/rules/typeorm-migrations.md` e na skill `typeorm` — sem instrução contraditória entre os dois.
- O `README.md` da raiz registra a versão fixada do TypeORM e a justificativa.

---

## Technical Specifications

### Error Catalog

**Error response format:**

```
{ statusCode, error, message }
```

Este é o formato de resposta de erro do subprojeto `nestjs-backend`, definido aqui por ser a primeira fase que introduz endpoints HTTP nele. As fases seguintes **herdam este formato** e apenas acrescentam linhas ao catálogo. O campo `error` carrega o código de domínio em `SCREAMING_SNAKE_CASE`; `message` carrega texto legível (ou a lista de mensagens de validação, no caso de 400); `statusCode` repete o status HTTP. Nenhuma resposta de erro expõe `stack trace`.

A Fase 01 não introduz erros de domínio próprios — não há regra de negócio nem entidade nesta fase. O catálogo abaixo registra apenas o comportamento genérico que o filtro global normaliza, para servir de referência às fases seguintes:

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| — | 400 | lista de mensagens de validação | Corpo de requisição reprovado pelo `ValidationPipe` global (propriedade não declarada ou tipo inválido) — erro genérico de framework, sem código de domínio |
| — | 404 | Cannot <METHOD> <path> | Requisição a rota não mapeada — erro genérico de framework, sem código de domínio |
| — | 500 | Internal server error | Exceção não tratada; resposta normalizada pelo filtro global sem `stack trace` |

---

## Dependency Map

```
SI-01.1 (sem deps)

SI-01.2 (sem deps)
├── SI-01.3
│   └── SI-01.4 (também depende de SI-01.2 e SI-01.7)
│       └── SI-01.5
├── SI-01.6
└── SI-01.7
    └── SI-01.4

SI-01.8 (sem deps)
```

Ordem sugerida de execução: **SI-01.1** e **SI-01.8** são independentes e podem ir a qualquer momento. **SI-01.2** destrava tudo o mais. **SI-01.7** precede **SI-01.4** porque sem `setupFiles: ["dotenv/config"]` o teste de integração do `DataSource` não consegue resolver `DB_HOST` dentro do container. **SI-01.5** fecha a fase exercitando o pipeline de migrations.

## Deliverables

- [ ] Branch `dev` criada a partir de `main` e publicada no remoto
- [ ] Links do repositório para o diagrama de arquitetura resolvem para arquivo existente
- [ ] `.env.example` versionado e `.env` fora do versionamento
- [ ] Aplicação aborta o boot quando variável de ambiente obrigatória está ausente ou inválida
- [ ] `docker compose up -d` sobe `db` e `nestjs-api`, ambos com status `running` e `db` aceitando conexões
- [ ] `compose.yaml` sem credenciais hardcoded e com volume nomeado no `db` (dados sobrevivem a `docker compose down`)
- [ ] TypeORM `0.3.x` conectado ao PostgreSQL com `synchronize: false` em todos os ambientes
- [ ] Ciclo `migration:run` → `migration:show` → `migration:revert` funcional, com a migration baseline habilitando `pgcrypto`
- [ ] `ValidationPipe` global, `helmet`, CORS restritivo, filtro global de erros e `enableShutdownHooks` ativos no bootstrap
- [ ] Formato de resposta de erro `{ statusCode, error, message }` aplicado a 400, 404 e 500, sem `stack trace`
- [ ] Jest com `setupFiles: ["dotenv/config"]` e `testRegex` cobrindo `spec` e `integration-spec`
- [ ] As nove rules de `.claude/rules/` com `paths:` casando com arquivos reais
- [ ] Skills sem `ssl: { rejectUnauthorized: false }`, sem opções Joi na forma plana e sem orientação contraditória sobre `synchronize`
- [ ] All SI tests pass in nestjs-backend (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass in nestjs-backend (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation check passes in nestjs-backend (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes in nestjs-backend (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully in nestjs-backend (`docker compose exec nestjs-api npm run build`)
