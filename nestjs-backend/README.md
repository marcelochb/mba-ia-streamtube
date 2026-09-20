# StreamTube — Backend API

API do StreamTube em NestJS 11 + TypeScript, PostgreSQL 17 e TypeORM `0.3.x`.

Este subprojeto roda **inteiramente em containers Docker**. Todo comando `npm`, `npx`, `node` e `tsc` executa dentro do container `nestjs-api` — rodar no host causa divergência de variáveis de ambiente (`DB_HOST` resolveria para `localhost` em vez do serviço do Compose) e usa outra versão do Node.

## Primeira execução

```bash
cp .env.example .env     # preencha DB_USERNAME, DB_PASSWORD e DB_NAME
docker compose up -d
docker compose exec nestjs-api npm install
```

> **A instalação de dependências é um passo manual de primeira execução.** O `Dockerfile.dev` termina em `CMD tail -f /dev/null` e não executa `npm install` no build — o container sobe vazio e aguarda. Sem esse `npm install`, nenhum comando abaixo funciona.

Verifique que o ambiente subiu:

```bash
docker compose ps                              # ambos devem estar "running"
docker compose exec db pg_isready -U $DB_USERNAME   # espera "accepting connections"
```

Aplique as migrations:

```bash
docker compose exec nestjs-api npm run migration:run
```

## Serviços

| Serviço | Descrição | Porta |
|---------|-----------|-------|
| `nestjs-api` | API NestJS | `3000` |
| `db` | PostgreSQL 17, com volume nomeado `pgdata` | `5432` |

Os dados do banco sobrevivem a `docker compose down` graças ao volume `pgdata`. Para descartá-los deliberadamente, use `docker compose down -v`.

## Configuração

As variáveis vêm de `.env`, versionado apenas como `.env.example`. O `.env` real **nunca** é commitado — está coberto pelo `.gitignore`.

A validação acontece na inicialização, via schema Joi (`src/config/validation.schema.ts`). Se uma variável obrigatória estiver ausente ou inválida, a aplicação **aborta o boot** listando todas as pendências de uma vez, em vez de subir e falhar depois na primeira requisição.

`DB_HOST` deve ser o nome do serviço no Compose (`db`), nunca `localhost`.

## Comandos

Todos com o prefixo `docker compose exec nestjs-api`:

```bash
npm run start:dev          # servidor com hot-reload
npm run build              # compila para dist/
npm test -- --runInBand    # unit + integração
npm run test:e2e           # end-to-end
npx tsc --noEmit           # type-check
npm run lint               # ESLint com auto-fix
```

### Migrations

```bash
npm run migration:create -- src/migrations/NomeDaMigration   # arquivo vazio
npm run migration:generate                                    # diff das entidades
npm run migration:run
npm run migration:show
npm run migration:revert
```

`synchronize` é **`false` em todos os ambientes**, sem exceção. Mudança de schema só chega ao banco por migration — ver `.claude/rules/typeorm-migrations.md`.

## Testes

| Sufixo | Tipo | Banco |
|--------|------|-------|
| `*.spec.ts` | Unitário, colaboradores mockados | Proibido |
| `*.integration-spec.ts` | Integração, banco real | Obrigatório |
| `*.e2e-spec.ts` | End-to-end via `supertest` (em `test/`) | Obrigatório |

Integração e e2e compartilham o mesmo banco, então rodam sempre com `--runInBand`. Execução paralela causa violação de FK, deadlock e contaminação entre suítes.

O Jest carrega o `.env` via `setupFiles: ["dotenv/config"]` — sem isso `DB_HOST` fica indefinido dentro do container.

### Transform do Jest

O projeto usa `@swc/jest` em vez de `ts-jest`. Motivo: `@nestjs/config@12` e `@nestjs/typeorm@12` são pacotes **ESM puros**, enquanto o núcleo do NestJS 11 é CommonJS. Transpilar esse grafo misto com `ts-jest` falha (`SyntaxError: Unexpected token 'export'` e, ao forçar o transform, colisão com o shim `createRequire(import.meta.url)` do `@nestjs/typeorm`). A configuração do `@swc/jest` está em `.swcrc`.

## Segurança do bootstrap

Configurado em `src/main.ts`:

- `helmet()` — headers de segurança, registrado antes de qualquer rota
- `X-Powered-By` desabilitado — não expõe o framework a quem faz fingerprint da stack
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`
- CORS restritivo por allow-list (`CORS_ORIGIN`) — nunca `*`
- Filtro global de exceções normalizando todo erro em `{ statusCode, error, message }`, sem `stack trace` no corpo da resposta
- `enableShutdownHooks()` — `SIGTERM`/`SIGINT` fecham o pool antes de encerrar

## Débito técnico conhecido

`npm audit` reporta 4 vulnerabilidades high na cadeia `multer` → `@nestjs/platform-express`. A correção exige subir para `@nestjs/platform-express@12` (breaking change), fora do escopo desta fase. O `multer` só passa a ser exposto de fato quando houver endpoint de upload — tratar antes da fase que implementar upload de vídeo.
