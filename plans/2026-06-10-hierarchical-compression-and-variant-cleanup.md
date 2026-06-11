# Plano: Compressão Hierárquica de Observações + Cleanup Language Variants

**Objetivo F:** Manter context injection enxuto à medida que o DB cresce. Hoje 63k+ obs sem retenção, mas só 50 mais recentes são injetadas. A camada histórica vira ruído inacessível.

**Objetivo G:** Limpar footers/exemplos verbosos pré-Fase 4 em 28 mode files de idioma.

**Ordem:** G primeiro (ship rápido). Depois F em 4 sub-fases.

---

## Fase 0 — Descoberta (consolidada)

### Estado atual — observações

| Aspecto | Realidade |
|---|---|
| Schema `observations` | `src/services/sqlite/schema.sql:57-83`. Tem `created_at_epoch`, índice `idx_observations_created`. |
| Auto-pruning | **Zero.** Nenhum `DELETE`, `VACUUM`, retention. |
| Context injection | `src/services/context/ObservationCompiler.ts:18-61` — ORDER BY `created_at_epoch DESC LIMIT ?` (default 50). |
| `CLAUDE_MEM_CONTEXT_OBSERVATIONS` | Default 50, validador `SettingsRoutes.ts:240` aceita 1-200. |
| Summary table | `session_summaries` — sem campos weekly/monthly digest. |
| ChromaSync | `ChromaSync.ts:102-158` — `formatObservationDocs()` quebra obs em múltiplos docs (per-field). |
| Migration system | `src/services/sqlite/migrations/runner.ts:11-37` — `MigrationRunner.runAllMigrations()`. Pattern: PRAGMA table_info → ALTER TABLE → INSERT INTO schema_versions. |
| Worker scheduled jobs | **Nenhum cron.** Só `initializeBackground()` em `worker-service.ts:293-411` roda uma vez no boot. |
| Token-budgeted context | **Não.** Limita por count, não tokens. |

### Estado atual — mode files

| Aspecto | Realidade |
|---|---|
| Total arquivos | 30 (`code--{lang}.json` × 29 + `code--chill.json`) |
| Têm `type_guidance`/`concept_guidance` | **0 arquivos.** Já estão limpos. Falso alarme. |
| Têm footer verboso ("Thank you so much", emoji blocks) | **28 arquivos** (todas as variantes de idioma; `code--chill.json` não tem footer próprio). |
| Base `code.json` | Já slimmed (Fase 4). |
| `code--pt-br.json` | Já slimmed (Fase 4). |
| Tests referenciando `code--*.json` | **Zero.** Safe to edit. |
| `deepMerge` behavior | `ModeManager.ts:64-79` — variant só precisa ter campos que sobrescreve. Strip = inherit base. |
| `ModePrompts.type_guidance`/`concept_guidance` | Marcados `?:` opcionais em `types.ts:22-23`. Backward-compat OK. |

### APIs / patterns para COPIAR (não inventar)

- **Migration pattern**: `src/services/sqlite/migrations/runner.ts` + métodos em `SessionStore.ts:addObservationContentHashColumn` (linha exata via grep `add.*Column`).
- **Query Observations**: copiar shape de `queryObservations()` em `ObservationCompiler.ts:18-61`.
- **Background task init**: `worker-service.ts:initializeBackground()` é o lugar canônico pra fire-once.
- **ChromaSync formatter**: `formatObservationDocs()` é o template pra fazer `formatDigestDocs()`.
- **Settings adicionar**: `src/shared/SettingsDefaultsManager.ts:DEFAULTS` (mesmo padrão dos Fases 1-5).

### Anti-padrões identificados

- ❌ Inventar `setInterval`/`cron` no worker — não existe scheduler. Use `initializeBackground` + boundary check.
- ❌ Mudar `queryObservations` signature — muitos call sites. Adicionar nova fn `queryDigests()` em paralelo.
- ❌ Deletar obs originais. Manter intactas; digest é índice agregado.
- ❌ Truncar mode JSON sem testar parse — todos os 30 files são JSON válido.
- ❌ Editar `code--chill.json` (não é language variant, é mode override completo).
- ❌ Esquecer de adicionar tests em `tests/cache-savings-guards.test.ts` quando criar novo tabela.

---

## Fase 1 — G: Cleanup language variant footers

**ROI:** alto/risco baixo. 30min. Ship sozinho como PR isolado.

### Tarefas

1. Para cada um dos 28 arquivos em `grep -l "Thank you so much\|✅\|❌" plugin/modes/code--*.json`:
   - Substituir `footer` por versão slim — mesmo formato que `code--pt-br.json` já usa (Fase 4):
     ```
     NÃO faça nenhum trabalho além de emitir OBSERVATIONS das mensagens de tool use. Você observa uma sessão Claude Code DIFERENTE. Nunca referencie a si mesmo. Emita APENAS o XML da observação — qualquer outra saída é descartada. Escreva o conteúdo em [LANG_NAME].
     ```
   - Substituir `summary_footer` analogamente.
   - **Não tocar** em `xml_*_placeholder` (essas são as traduções legítimas que queremos manter).
   - **Não tocar** em `continuation_instruction` (mesma razão).

2. Tradução do template slim pra cada idioma. Quando incerto, manter inglês com sufixo "Write content in [LANG]". Anti-padrão: traduzir errado um termo técnico.

3. Validar JSON de cada arquivo: `for f in plugin/modes/code--*.json; do python3 -c "import json; json.load(open('$f'))" && echo "$f OK"; done`.

4. Medir redução total: `wc -c plugin/modes/code--*.json` antes/depois.

### Verificação

- Testes existentes passam (`npx bun test tests/system-prompt-determinism.test.ts tests/cache-savings-guards.test.ts`).
- Não tocou em `code.json` nem `code--chill.json` nem `code--pt-br.json`.
- Cada arquivo continua parsing.
- `grep -l "Thank you so much" plugin/modes/code--*.json` → 0 matches.

### Anti-padrões

- ❌ Re-slimmar `code--pt-br.json` (já feito Fase 4).
- ❌ Mexer em `code--chill.json` (override completo de mode, não tradução).
- ❌ Remover `xml_*_placeholder` translation overrides.
- ❌ Bater Github sem JSON validation.

---

## Fase 2 — F.1: Schema + types pra digests

**Pré-requisito de F.2-F.4.**

### Tarefas

1. **Nova tabela** em `src/services/sqlite/schema.sql` após `session_summaries`:

   ```sql
   CREATE TABLE IF NOT EXISTS observation_digests (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     project              TEXT    NOT NULL,
     period_start_epoch   INTEGER NOT NULL,
     period_end_epoch     INTEGER NOT NULL,
     period_kind          TEXT    NOT NULL CHECK(period_kind IN ('weekly', 'monthly')),
     obs_count            INTEGER NOT NULL,
     dominant_types       TEXT,            -- JSON array
     dominant_concepts    TEXT,            -- JSON array
     summary_text         TEXT    NOT NULL, -- LLM-generated narrative
     facts                TEXT,            -- JSON array of key facts
     files_touched        TEXT,            -- JSON array
     created_at           TEXT    NOT NULL,
     created_at_epoch     INTEGER NOT NULL,
     UNIQUE(project, period_kind, period_start_epoch)
   );

   CREATE INDEX IF NOT EXISTS idx_digests_project_period
     ON observation_digests(project, period_kind, period_start_epoch DESC);
   ```

2. **Migration** em `src/services/sqlite/migrations/runner.ts`:
   - Bumpar `LATEST_SCHEMA_VERSION` para próxima versão.
   - Adicionar `addObservationDigestsTable()` na ordem em `runAllMigrations`.
   - Copiar pattern de `SessionStore.ts:addObservationsMetadataColumn` (procurar via grep).

3. **Types** em `src/services/sqlite/types.ts`:
   ```typescript
   export interface ObservationDigest {
     id: number;
     project: string;
     period_start_epoch: number;
     period_end_epoch: number;
     period_kind: 'weekly' | 'monthly';
     obs_count: number;
     dominant_types: string[];
     dominant_concepts: string[];
     summary_text: string;
     facts: string[];
     files_touched: string[];
     created_at_epoch: number;
   }
   ```

4. **Settings** em `src/shared/SettingsDefaultsManager.ts`:
   ```typescript
   CLAUDE_MEM_DIGEST_ENABLED: 'true',
   CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '30',      // Comprimir obs > N dias
   CLAUDE_MEM_DIGEST_PERIOD: 'weekly',         // weekly | monthly
   CLAUDE_MEM_DIGEST_MAX_OBS_PER: '100',       // Cap por digest pra LLM aceitar
   ```

### Verificação

- `npx tsc --noEmit 2>&1 | grep -E "schema|migrations|types"` → 0 errors.
- Test: `tests/digest-schema.test.ts` (novo) — abre DB temp, roda migration, confirma table existe via `PRAGMA table_info(observation_digests)`.
- Schema version bumpou: `SELECT version FROM schema_versions ORDER BY id DESC LIMIT 1` retorna nova versão.

### Anti-padrões

- ❌ Adicionar coluna em `observations` em vez de tabela própria — quebra index/queries existentes.
- ❌ `period_end_epoch` < `period_start_epoch` — adicionar CHECK constraint se quiser robustez.
- ❌ Esquecer UNIQUE constraint — re-execução geraria duplicatas.
- ❌ Pular index — query de digest por projeto será frequente.

---

## Fase 3 — F.2: Geração de digests (background job)

### Tarefas

1. **Novo módulo** `src/services/worker/digest/DigestGenerator.ts`:

   ```typescript
   export class DigestGenerator {
     constructor(
       private store: SessionStore,
       private provider: ClaudeProvider | DeepSeekProvider | ...,
     ) {}

     async generateMissingDigests(): Promise<{ generated: number; skipped: number }> {
       // 1. Para cada project, encontrar últimas N semanas/meses sem digest
       // 2. Para cada período sem digest:
       //    - SELECT obs WHERE project = ? AND created_at_epoch BETWEEN ? AND ?
       //    - Se obs.length == 0 → skip
       //    - Se obs.length > MAX → truncar para MAX mais relevantes (gods, decision, security)
       //    - Chamar LLM com prompt de compressão
       //    - INSERT INTO observation_digests
     }
   }
   ```

2. **Prompt template** em `src/sdk/prompts.ts` (novo):
   ```typescript
   export function buildDigestPrompt(obs: Observation[], periodLabel: string): string {
     // Stable system prompt (cacheable) + dynamic obs list
     return `... compress these ${obs.length} observations from ${periodLabel} into:
       - summary_text: 2-3 paragraph narrative
       - facts: 5-10 key facts
       - dominant_types: most common observation types
       - dominant_concepts: recurring concepts
       - files_touched: union of files
     Return XML <digest>...</digest>`;
   }
   ```

3. **Parser** em `src/sdk/parser.ts` — adicionar `parseDigest(xml)` análogo a `parseObservation`.

4. **Hook no boot** em `src/services/worker-service.ts:initializeBackground()`:
   ```typescript
   if (settings.CLAUDE_MEM_DIGEST_ENABLED === 'true') {
     this.digestGenerator.generateMissingDigests().catch(err => {
       logger.warn('SYSTEM', 'Digest generation failed', undefined, err);
     });
   }
   ```
   Fire-and-forget, não bloqueia worker startup.

5. **Concurrency guard**: digest job não pode rodar concorrente com session generators. Usar mutex simples ou aguardar `getActiveSessionCount() === 0`.

### Verificação

- Unit test em `tests/digest-generator.test.ts`:
  - Cria 100 obs fake em DB temp espalhadas por 4 semanas.
  - Mock provider retorna XML válido.
  - Roda `generateMissingDigests()`.
  - Assert: 4 rows em `observation_digests`.
  - Re-roda: 0 novas (idempotente via UNIQUE constraint).
- Integration: rodar com DeepSeek real numa cópia do DB e validar XML parse.

### Anti-padrões

- ❌ Bloquear `initializeBackground` aguardando LLM — fire-and-forget.
- ❌ Re-comprimir obs já cobertas por digest existente.
- ❌ Reusar `buildObservationPrompt` — shape diferente. Builder novo.
- ❌ Não respeitar `period_kind` setting — gerar weekly se config for monthly desperdiça tokens.
- ❌ Ignorar erro de parse — log warn + skip período, não bloquear outros.

---

## Fase 4 — F.3: Context injection mix obs + digests

### Tarefas

1. **Nova função** em `ObservationCompiler.ts`:
   ```typescript
   export function queryDigests(
     db: Database,
     project: string,
     config: ContextConfig,
   ): ObservationDigest[] {
     // SELECT * FROM observation_digests
     //   WHERE project = ?
     //   ORDER BY period_start_epoch DESC
     //   LIMIT ?
   }
   ```

2. **Novo setting** `CLAUDE_MEM_CONTEXT_DIGESTS = '5'` em `SettingsDefaultsManager.ts`.

3. **Modificar `ContextBuilder.ts`** — injetar M digests como bloco separado antes/depois da timeline de obs recentes:
   ```
   ## Historical digests (oldest first)
   week of YYYY-MM-DD: <summary_text> [N obs]
   ...

   ## Recent observations (last 50)
   ...
   ```

4. **Formatter** em `src/services/context/formatters/DigestFormatter.ts`:
   - Render compacto: title + count + 1 frase de summary
   - Token-conscious

### Verificação

- Test `tests/context-injection-digests.test.ts`:
  - Setup DB com 5 digests + 50 obs.
  - Run `generateContext()`.
  - Assert: output inclui ambos blocks.
  - Assert: token budget total ≤ baseline + 1000 (digests não inflam).
- Visual: rodar `bun scripts/inspect-cache-savings.ts` numa DB real.

### Anti-padrões

- ❌ Misturar digests no LIMIT do `queryObservations` — eles têm shape diferente.
- ❌ Substituir obs recentes por digests — perde detalhe operacional.
- ❌ Renderizar `summary_text` completo (paragráfos longos) — formato compacto.
- ❌ Não testar com `CLAUDE_MEM_DIGEST_ENABLED=false` — deve cair pro comportamento atual.

---

## Fase 5 — F.4: ChromaSync para digests

### Tarefas

1. **Adicionar** `syncDigest(digest: ObservationDigest)` em `src/services/sync/ChromaSync.ts`:
   - Copiar shape de `syncObservation()` (linha 306-348).
   - `formatDigestDocs(digest)` retorna 1-2 documents (summary + facts joined).
   - `field_type` metadata = `'digest_summary'` ou `'digest_facts'`.

2. **Backfill** chamado a partir do `DigestGenerator` após cada INSERT.

3. **Watermark separado** — não reusar watermark de `observations` (eles vão dessincronizar). Adicionar `observation_digests` ao `ChromaSync.backfill()`.

### Verificação

- Test mock Chroma — confirmar `addDocuments` foi chamado com shape correto.
- Real: rodar digest e fazer `/graphify query` ou `mem-search` que pega digest.

### Anti-padrões

- ❌ Indexar `summary_text` inteiro como 1 doc — break em chunks se > 8k chars.
- ❌ Esquecer `field_type` metadata — confunde frontend filtros.
- ❌ Mixar `sqlite_id` de digest e obs — usar prefixo `digest:` ou tabela separada de metadata.

---

## Fase 6 — Verificação ponta a ponta

### Métricas

| Métrica | Antes | Depois (esperado) |
|---|---|---|
| Linhas em `observations` | crescendo linear | mesmo |
| Linhas em `observation_digests` | 0 | N por projeto × período |
| Context injection tokens | baseline (~7.6k pra 50 obs) | baseline + ~1k (digests compactos) |
| Cobertura histórica acessível | últimas 50 obs | últimas 50 + N digests cobrindo meses |
| DB size em MB | crescendo | mesmo (digests pequenos vs obs originais) |

### Checklist

- [ ] G: `grep -l "Thank you so much" plugin/modes/code--*.json` → 0 matches
- [ ] G: tamanho total `code--*.json` reduzido ≥ 30%
- [ ] F.1: schema migration aplica em DB fresca e legacy
- [ ] F.2: digest job idempotente (re-run não duplica)
- [ ] F.3: context injection mostra ambos blocks
- [ ] F.4: Chroma indexa digests com metadata correta
- [ ] Tests: `tests/cache-savings-guards.test.ts` updated pra Fase 2+3 markers
- [ ] Build: `npm run build-and-sync` clean
- [ ] Worker boot: `initializeBackground` não bloqueia

### Grep guards anti-pattern

```bash
# Digest gen não chamado dentro de session generator
! grep -rn "generateMissingDigests" src/services/worker/agents/
# Schema version bumpou
test $(sqlite3 ~/.claude-mem/claude-mem.db "SELECT MAX(version) FROM schema_versions") -ge <NEW_VERSION>
# Digests não duplicam obs em context
! grep -nE "queryObservations.*queryDigests\|UNION.*observations.*observation_digests" src/services/context/
```

---

## Sequência recomendada de PRs

1. **PR 1 — Fase 1 (G)** — slim 28 language variant footers. ~30min. Ship solo.
2. **PR 2 — Fase 2 (F.1)** — schema + types + migration. Não muda comportamento ainda. Safe.
3. **PR 3 — Fase 3 (F.2)** — digest generator + boot hook. Feature flag desligada por default em produção até validar.
4. **PR 4 — Fase 4 (F.3)** — context injection mix. Habilitar feature flag.
5. **PR 5 — Fase 5 (F.4)** — Chroma indexing.
6. **PR 6 — Fase 6** — métricas + checklist + atualizar `cache-savings-guards.test.ts`.

## Tempo estimado

| Fase | Esforço |
|---|---|
| 1 (G cleanup) | 30min |
| 2 (schema) | 1h |
| 3 (generator) | 3h |
| 4 (context) | 2h |
| 5 (Chroma) | 1h |
| 6 (verify) | 1h |
| **Total** | **~8h** |

## Notas

- Manter feature flag `CLAUDE_MEM_DIGEST_ENABLED` por 2 releases.
- Update `plans/2026-05-22-prompt-cache-prefilter.md` com link cross-ref quando F entrar em produção.
- Adicionar SHAs ao final deste arquivo conforme cada fase fecha.

---

## Resultados Finais

Linha de chegada (commit SHA por fase):

- Fase 1 (G — slim variant footers): `c509331f`
- Fase 2 (F.1 — schema + migration v33): `2e4641ef`
- Fase 3 (F.2 — DigestGenerator + boot hook): `25382253`
- Fase 4 (F.3 — context mix obs + digests): `b4228a3c`
- Fase 5 (F.4 — Chroma indexes digests): `ea3d47a4`
- Fase 6 (este — guards + Resultados Finais): TBD (commit do orchestrator)

Tamanhos (Fase 1):
- `plugin/modes/code--*.json` total: 94,899 → 70,110 bytes (−26.1%)

Schema (Fase 2):
- Nova tabela: `observation_digests` (13 cols, UNIQUE(project, period_kind, period_start_epoch))
- Index `idx_digests_project_period`
- Schema version bumpou para `33`
- Settings novas: `CLAUDE_MEM_DIGEST_ENABLED`, `_MIN_AGE_DAYS`, `_PERIOD`, `_MAX_OBS_PER` (default OFF)

Digest job (Fase 3):
- `DigestGenerator` em `src/services/worker/digest/`
- Boot hook fire-and-forget com 30s grace period abort-aware
- Limites: `MAX_DIGESTS_PER_RUN=50`, `RUN_TIME_BUDGET_MS=60_000`
- Sequencial (concurrency=1)
- `DeepSeekProvider.compressDigest` single-shot
- Duck-type guard p/ outros providers (debug log)

Validação real (run de 2026-06-11 00:16-00:34):
- 4 projetos elegíveis (`AgentStudio`, `cadastro+fofa_nick`, `cadastronick`, `claude_mem+ollama`)
- Run 1 (00:16:27 → 00:17:33, ~66s): **6 digests gerados**, comprimindo **422 observations** (100+100+100+35+4+83), stop reason `Run time budget exceeded mid-project` em `claude_mem+ollama` — design correto
- Run 2 (00:34:24 → 00:34:34, ~10s): **1 digest adicional** (`claude_mem+ollama week of 2026-05-11`, 14 obs) — confirma idempotência via UNIQUE constraint (não reprocessou os 6 já feitos)
- Total: **7 digests** comprimindo **436 observations** em summaries de 922-1587 chars (média ~1306)
- Custo DeepSeek não-isolável no log (digest e session generators logam pelo mesmo `[SDK]` channel); janela 00:16:27-00:17:33 mostra 9 calls totalizando ~$0.0113 mas inclui tráfego concorrente de session generators rodando em paralelo
- Falhas: 0

Context injection (Fase 4):
- Nova setting: `CLAUDE_MEM_CONTEXT_DIGESTS='5'` (default 5 digests/sessão)
- Ordem: Header → Digests → Timeline → Previously → Footer
- `MAX_DIGEST_PREVIEW_CHARS=200` com strip de markdown trailing
- Empty state guard requer observations + summaries + digests todos vazios

Chroma sync (Fase 5):
- `ChromaSync.syncDigest` indexa digest após insert no SQLite
- ID format: `digest_{id}_summary`, `digest_{id}_facts` (convenção `entity_{id}_field`)
- `deduplicateQueryResults` extendido com `digest_(\d+)_` → entity `observation_digest`
- Best-effort: Chroma down NÃO aborta digest run

Novos arquivos (consolidado):
- `src/services/worker/digest/DigestGenerator.ts` (Fase 3)
- `src/services/worker/digest/periods.ts` (Fase 3)
- `src/services/context/formatters/DigestFormatter.ts` (Fase 4)
- `tests/observation-digests-schema.test.ts` (Fase 2)
- `tests/digest-periods.test.ts` (Fase 3)
- `tests/digest-generator.test.ts` (Fase 3)
- `tests/context-digests-injection.test.ts` (Fase 4)
- `tests/chroma-digest-sync.test.ts` (Fase 5)

Cobertura de testes (Fase 6 capstone):
- 18 testes em `digest-periods.test.ts`
- 10 testes em `digest-generator.test.ts`
- 11 testes em `observation-digests-schema.test.ts`
- 22 testes em `context-digests-injection.test.ts`
- 12 testes em `chroma-digest-sync.test.ts`
- 33 testes em `cache-savings-guards.test.ts` (26 anteriores + 7 markers Fase 5/6)

Branches stacked (6):

```
feat/slim-language-variant-footers    (Fase 1 — G)
feat/observation-digests-schema       (Fase 2 — F.1)
feat/digest-generator                 (Fase 3 — F.2)
feat/context-mix-digests              (Fase 4 — F.3)
feat/chroma-sync-digests              (Fase 5 — F.4)
feat/digest-final-verification        (Fase 6 — este)
```

Como ativar:

```bash
# settings.json
"CLAUDE_MEM_DIGEST_ENABLED": "true"
# Próximo restart do worker dispara job 30s após boot
```

Como inspecionar:

```bash
sqlite3 ~/.claude-mem/claude-mem.db \
  "SELECT project, period_kind, datetime(period_start_epoch/1000, 'unixepoch'), obs_count, length(summary_text) FROM observation_digests ORDER BY id DESC LIMIT 20"
```

Gaps conhecidos (deferred):
- `observation_digests` sem coluna `merged_into_project` — projetos merged não cross-fertilizam digests (precisa migration v34)
- `ChromaSync.runBackfillPipeline` não cobre digests — worker que morre entre INSERT e syncDigest deixa digest fora do Chroma até próxima geração do mesmo período
- Outros providers (Claude, Gemini, Ollama, OpenRouter) sem `compressDigest` — `DigestGenerator` log debug e early-returns
- Variantes de idioma usaram English fallback p/ sentenças 1-4 em `bn`/`th`/`ur`
- Custo de digest não-isolável nos logs `[SDK]` atuais (compartilha channel com session generators); adicionar tag `[DIGEST_SDK]` ou campo `kind=digest` no log seria útil pra observability futura

Próximos passos opcionais (fora do escopo do plano):
- Schema v34 com `merged_into_project` em `observation_digests`
- Backfill watermark p/ digests no Chroma
- `compressDigest` em outros providers
- Token-budgeted injection em vez de count-based em `ContextBuilder`
- Investigar root cause do wedge recorrente durante `build-and-sync`
