# StreamTube

Plataforma de compartilhamento de vídeos (estilo YouTube). Usuários podem enviar, gerenciar e publicar vídeos. Visitantes anônimos assistem livremente; recursos sociais (comentários, inscrições, likes) exigem autenticação.

Visão geral completa: [docs/project-plan.md](docs/project-plan.md) · Arquitetura: [docs/diagrams/software-arch.mermaid](docs/diagrams/software-arch.mermaid)

## Estrutura do monorepo

| Diretório | Conteúdo |
|-----------|----------|
| `nestjs-backend/` | API backend (NestJS 11, TypeScript, Express) — módulos de usuários, canais, vídeos, comentários |
| `next-frontend/` | Frontend (Next.js) — **ainda não inicializado** |
| `docs/` | Documentação do projeto, diagramas de arquitetura, decisões técnicas e planos de fase |

## Fluxo de branches

O projeto segue as convenções do Git Flow, com duas branches de longa duração:

- **`main`** — código estável, pronto para produção. Nunca recebe commit direto.
- **`dev`** — branch de integração. Todo trabalho parte de `dev` e retorna para `dev`.

Branches de trabalho partem de `dev` e são mescladas de volta em `dev`:

| Prefixo | Uso |
|---------|-----|
| `feature/*` | Nova funcionalidade |
| `bugfix/*` | Correção de defeito |
| `hotfix/*` | Correção urgente |
| `docs/*` | Alteração apenas de documentação |

Quando `dev` está estável, é mesclada em `main`.

## Ambiente de desenvolvimento

O projeto roda inteiramente em containers Docker. Serviços se comunicam pela rede do Docker Compose usando **o nome do serviço como host** — nunca `localhost`, que dentro de um container aponta para o próprio container.

```bash
cd nestjs-backend
cp .env.example .env
docker compose up -d
docker compose exec nestjs-api npm install   # primeira execução
```

Detalhes de setup, migrations e testes: [nestjs-backend/README.md](nestjs-backend/README.md).

## Decisões de versionamento de dependências

### TypeORM fixado na linha `0.3.x`

O projeto fixa deliberadamente `typeorm@^0.3.31`, publicado sob a dist-tag `legacy`. A linha `1.x` **já é a `latest` estável** no npm (`1.1.1` em 19/09/2026) e `@nestjs/typeorm@12` a aceita — a fixação é uma escolha consciente, não uma limitação de compatibilidade.

**Motivo:** todas as rules da skill `.claude/skills/typeorm/` e a rule `.claude/rules/typeorm-migrations.md` foram escritas contra a API `0.3`. Subir para a linha `1.x` sem reescrevê-las faria a orientação de IA divergir silenciosamente do código real — o pior modo de falha para uma base guiada por rules.

**Critério para migrar para `1.x`:**

1. As rules de `.claude/skills/typeorm/` serem revisadas e atualizadas contra a API `1.x`, incluindo mudanças de `DataSource`, CLI de migrations e API de repositórios.
2. A suíte de testes de integração passar integralmente na nova versão antes do merge em `dev`.
3. A migração ser validada com o ciclo completo `migration:run` → `migration:revert` contra um banco limpo.

Enquanto a fixação durar, vale registrar que `legacy` deixa de receber features novas e tende a receber apenas correções críticas — o custo de adiar a migração cresce com o tempo.

A migração deve ser uma mudança isolada, em branch própria, sem misturar escopo com feature.
