# Plano: Prompt Caching + Pré-filtro Hook

**Objetivo:** reduzir custo de tokens da geração de observações sem perder qualidade da memória.

**Linha de base (medida):** ~402k tokens de trabalho LLM / sessão para ~30 observações. Boilerplate por turno (~3KB de XML + ~10KB de mode prompt) reinjetado em todos os turnos. Pré-filtro determinístico já existe mas é raso (apenas nome da tool).

**Ordem de execução:** Fase 0 → 1 → 2 → 3 → 4 → 5. Cada fase é auto-contida e pode rodar em contexto novo.

---

## Fase 0 — Descoberta (já realizada, consolidada aqui)

### APIs disponíveis (citadas com arquivo:linha)

#### Pipeline de prompt
- `src/sdk/prompts.ts:24-79` — `buildInitPrompt(project, sessionId, userPrompt, mode)` — concatena `mode.prompts.system_identity` + `observer_role` + `spatial_awareness` + `recording_focus` + `skip_guidance` + `output_format_header` + XML scaffold + `footer` numa **única string**.
- `src/sdk/prompts.ts:90-122` — `buildObservationPrompt(obs)` — string por tool_use, sem preâmbulo (depende de init).
- `src/sdk/prompts.ts:124-156` — `buildSummaryPrompt(session, mode)` — string completa.
- `src/sdk/prompts.ts:158-217` — `buildContinuationPrompt` — reinjeta TODO o `system_identity + observer_role + ... + format_examples + footer` por turno.
- `MAX_TOOL_FIELD_CHARS = 4000` em `src/sdk/prompts.ts:81`.

#### Providers (todos consumem string única via concat)
- `src/services/worker/ClaudeProvider.ts:180-195` — usa `query()` de `@anthropic-ai/claude-agent-sdk` ^0.2.119. **SDK de agente, não API raw.** Não aceita `cache_control` direto; usa processo Claude Code interno.
- `src/services/worker/ClaudeProvider.ts:351-432` — `createMessageGenerator`: yield init/continuation/observation/summary como `SDKUserMessage` (role='user').
- `src/services/worker/OllamaProvider.ts:420-440` — `fetch POST /chat/completions`, corpo `{model, messages, temperature, max_tokens, options:{num_ctx}}`. **Sem role system, sem cache_control.**
- `src/services/worker/DeepSeekProvider.ts:438-461` — `fetch POST /chat/completions`, mesmo padrão OpenAI. **DeepSeek faz context cache automático (gratuito) quando prefixo idêntico — não requer cache_control.**
- `src/services/worker/OpenRouterProvider.ts:437-453` — idem OpenAI-compatible. OpenRouter suporta `cache_control: {type: 'ephemeral'}` em `content` blocks para modelos Anthropic.
- `src/services/worker/GeminiProvider.ts:441-466` — `fetch POST /generateContent`, corpo `{contents, generationConfig}`. **Gemini aceita `systemInstruction` (campo separado) que entra automaticamente no implicit cache.**

#### Dispatch
- `src/services/worker-service.ts:489-503` — `getActiveAgent()`: ordem Ollama → DeepSeek → OpenRouter → Gemini → Claude.

#### Pré-filtro existente (hook layer)
- `src/services/worker/http/shared.ts:97-152` — `ingestObservation()`. Filtros atuais:
  - `:106-108` — `isProjectExcluded(cwd)`
  - `:110-115` — `CLAUDE_MEM_SKIP_TOOLS` (default `'ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion'`)
  - `:117-124` — file_path contém `session-memory`
  - `:142-152` — privacy tag
- Payload medível em `shared.ts:154-159` (após `JSON.stringify`). **Ponto cirúrgico de inserção.**
- Schema entrada: `src/services/worker/http/routes/SessionRoutes.ts:251-262` (zod).
- Persistência: `src/services/sqlite/PendingMessageStore.ts:32-62` `enqueue()`.

#### Settings defaults
- `src/shared/SettingsDefaultsManager.ts:83` — `CLAUDE_MEM_SKIP_TOOLS`.
- Adicionar novas chaves segue o mesmo padrão.

### Anti-padrões identificados
- ❌ Não inventar `cache_control` no ClaudeProvider — agent SDK não expõe. Ou trocar para `@anthropic-ai/sdk` raw, ou aceitar caching implícito do processo filho.
- ❌ Não usar `system` em Ollama com modelos que ignoram (alguns Ollama models tratam system como user). Verificar por modelo.
- ❌ Não filtrar por nome de tool numa segunda lista — extender o `CLAUDE_MEM_SKIP_TOOLS` existente.
- ❌ Não duplicar lógica de filtro em locais diferentes do pipeline — só em `ingestObservation()`.
- ❌ Não medir tamanho de payload APÓS `stripMemoryTagsFromJson` (já foi modificado); usar a stringificação local.

### Confiança e gaps
- Alta: estrutura dos providers, ponto de inserção do filtro, settings.
- Média: comportamento do `@anthropic-ai/claude-agent-sdk` quanto a caching implícito. Validar Fase 3 testando duas sessões consecutivas e checando custo de input.
- Gap: nenhum fixture com payload bruto do hook windsurf — usar logs reais durante teste.

---

## Fase 1 — Pré-filtro determinístico expandido (HOOK LAYER)

**ROI: alto. Risco: baixo. Sem mudança de contrato.**

### O que implementar

Adicionar filtros baseados em tamanho/conteúdo dentro de `ingestObservation()` em `src/services/worker/http/shared.ts`, antes da chamada a `sessionManager.queueObservation()` (linha 161).

**Filtros novos a adicionar (todos copiáveis do padrão `tool_excluded` em `:110-115`):**

1. **Bash trivial:** `toolName === 'Bash'` E stringified `toolResponse` ≤ 80 chars E não contém `error|fail|exception` (case-insensitive). Reason: `bash_trivial`.

2. **Glob/Grep vazio:** `toolName ∈ {'Glob','Grep'}` E `toolResponse` indica zero matches (string `'No matches found'` OU array vazio OU `numFiles: 0`). Reason: `search_empty`.

3. **Read pequeno:** `toolName === 'Read'` E `toolResponse` (após stringify) ≤ 500 bytes E não contém `error`. Reason: `read_small`.

4. **Read repetido:** `toolName === 'Read'` E `file_path` já lido nessa sessão sem `Edit/Write` intermediário. Requer cache em memória keyed por `contentSessionId`. Reason: `read_dup`.
   - **Onde armazenar cache:** novo módulo `src/services/worker/http/SessionReadCache.ts`, Map<contentSessionId, Set<filePath>> com TTL 30min ou clear no `session_end` event.
   - Limpar entrada de `file_path` quando vier um `Edit/Write` daquele caminho.

5. **Tamanho máximo:** `tool_input.length + tool_response.length > N` (default 50_000 chars). Reason: `oversized`. Setting opcional `CLAUDE_MEM_MAX_TOOL_CHARS`.

### Settings novas

Em `src/shared/SettingsDefaultsManager.ts:DEFAULTS`:

```typescript
CLAUDE_MEM_PREFILTER_ENABLED: 'true',
CLAUDE_MEM_PREFILTER_BASH_MIN_OUTPUT: '80',
CLAUDE_MEM_PREFILTER_READ_MIN_BYTES: '500',
CLAUDE_MEM_PREFILTER_MAX_TOTAL_CHARS: '50000',
CLAUDE_MEM_PREFILTER_DEDUP_READS: 'true',
```

Default ON. Cada um desligável.

### Tarefas (copie padrões dos seguintes locais)

1. Criar `src/services/worker/http/PrefilterDecider.ts` com função pura `decidePrefilter(payload, sessionReadCache, settings): { skip: true, reason: string } | { skip: false }`. Cobertura para os 5 filtros acima. Copie estilo de `IngestResult` em `shared.ts:80-83`.
2. Criar `src/services/worker/http/SessionReadCache.ts`. Padrão: classe com `markRead(sessionId, path)`, `hasRead(sessionId, path)`, `invalidate(sessionId, path)`, `clearSession(sessionId)`. Copie estilo de `RateLimitStore.ts` (já existe no diretório `src/services/worker/`).
3. Em `src/services/worker/http/shared.ts:124` (após o bloco `session_memory_meta`), inserir:
   ```typescript
   if (settings.CLAUDE_MEM_PREFILTER_ENABLED === 'true') {
     const decision = decidePrefilter(payload, sessionReadCache, settings);
     if (decision.skip) {
       return { ok: true, status: 'skipped', reason: decision.reason };
     }
     // marcar Read e invalidar em Edit/Write
     updateReadCache(payload, sessionReadCache);
   }
   ```
4. Adicionar testes unitários em `tests/` espelhando padrão existente (verificar `tests/` antes — copie estrutura de um teste similar).
5. Atualizar `src/shared/SettingsDefaultsManager.ts:DEFAULTS` + tipo `Settings` (mesma seção, linhas próximas a `CLAUDE_MEM_SKIP_TOOLS`).

### Verificação

- `grep -n "decidePrefilter\|sessionReadCache" src/services/worker/http/shared.ts` → 2+ matches.
- Rodar testes: `npm test`.
- Sanity: rodar uma sessão real, abrir `~/.claude-mem/claude-mem.db`, contar `pending_messages` por sessão → deve cair vs. baseline (~30-50% menos linhas para sessões com muito Read/Bash trivial).
- Logs: `tail -f ~/.claude-mem/logs/worker.log | grep skipped` durante uso.

### Anti-padrões a evitar

- ❌ Filtrar dentro de `PendingMessageStore.enqueue` (atrasa, payload já carregado).
- ❌ Filtrar no provider (LLM já viu).
- ❌ Filtrar por regex no conteúdo da tool — heurísticas frágeis. Usar só tamanho e nome.
- ❌ Falsos positivos em `Bash`: NÃO filtrar se exit_code ≠ 0 (erro é signal). Verificar campo `stderr`/`exitCode` se presente no payload.
- ❌ Esquecer de invalidar cache de Read quando ocorre Edit/Write do mesmo arquivo → causaria perda de memória sobre mudanças.

---

## Fase 2 — Separar `system` vs `user` nos providers OpenAI-compatible

**Pré-requisito de Fase 3. ROI imediato em DeepSeek (cache automático).**

### O que implementar

Hoje `buildInitPrompt`/`buildContinuationPrompt` retornam **uma string**. Vamos extrair a porção estável (system identity + mode prompts + XML scaffold + footer) num **segundo prompt builder**, e deixar `buildInitPrompt` retornar só o conteúdo dinâmico (user_request, requested_at, header_memory_start).

### Tarefas

1. Em `src/sdk/prompts.ts`, adicionar:
   ```typescript
   export function buildSystemPrompt(mode: ModeConfig): string {
     // tudo que não depende de userPrompt/session:
     // system_identity, observer_role, spatial_awareness,
     // recording_focus, skip_guidance, output_format_header,
     // XML scaffold (placeholders), format_examples, footer
   }
   ```
   **Importante:** `buildSystemPrompt` deve ser **determinístico por mode** — chamada com o mesmo `mode` deve retornar string idêntica byte-a-byte. Não usar `Date`, `Math.random`, etc.

2. Refatorar `buildInitPrompt` e `buildContinuationPrompt` para retornar **apenas a parte dinâmica**:
   ```typescript
   // antes: string única
   // depois: { system: string, user: string } OU manter assinatura mas extrair partes estáveis
   ```
   Forma sugerida: manter assinatura atual mas adicionar `buildSystemPrompt(mode)` como função separada; alterar consumidores para passar `system` separadamente quando o provider suportar.

3. Atualizar `OllamaProvider.ts:150-151`, `:267-276`, `:306-314` — adicionar `messages[0] = { role: 'system', content: buildSystemPrompt(mode) }` no primeiro turno; nos turnos seguintes não repetir.

4. Atualizar `DeepSeekProvider.ts:169-171`, `:292-301`, `:333-341` — idem.

5. Atualizar `OpenRouterProvider.ts:163-165`, `:288-297`, `:330-339` — idem.

6. Atualizar `GeminiProvider.ts:207-209`, `:298-307`, `:342-350` — adicionar `systemInstruction: { parts: [{ text: buildSystemPrompt(mode) }] }` no body do fetch (`:441-466`).

7. `ClaudeProvider.ts:351-432` — **não tocar nesta fase.** Agent SDK gerencia internamente. Tratado na Fase 3.

### Verificação

- `grep -n "role: 'system'" src/services/worker/{Ollama,DeepSeek,OpenRouter}Provider.ts` → 1+ em cada.
- `grep -n "systemInstruction" src/services/worker/GeminiProvider.ts` → 1+.
- Verificar com `buildSystemPrompt(mode) === buildSystemPrompt(mode)` retorna mesma string (snapshot test).
- Smoke test: rodar uma sessão com `CLAUDE_MEM_PROVIDER=deepseek`, ver no log de resposta da API que `prompt_cache_hit_tokens > 0` no segundo turno. DeepSeek retorna esse campo em `usage`.

### Anti-padrões

- ❌ Concatenar dinâmico+estático e marcar inteiro como system. Quebra cache no segundo turno.
- ❌ Mudar a ORDEM dos fragmentos do system_prompt entre versões — invalida cache acumulado.
- ❌ Incluir `Date.now()` ou ISO date no system. Deixe data dinâmica fora.
- ❌ Quebrar formato XML — se XML scaffold sai do system para o user, model pode parar de seguir.

---

## Fase 3 — Cache markers explícitos (Anthropic + OpenRouter)

**Apenas onde o provider suporta `cache_control` explícito.**

### Contexto

- **DeepSeek:** já cacheia automaticamente depois da Fase 2 (cache implícito por prefixo estável). Nada a fazer.
- **Gemini:** `systemInstruction` entra no implicit cache automático para modelos >32k context. Nada a fazer após Fase 2.
- **Ollama:** local. Sem caching API. Nada a fazer.
- **OpenRouter (modelos Anthropic):** precisa `cache_control: {type: 'ephemeral'}` em blocks. Aceita formato Anthropic via OpenRouter.
- **Claude via agent SDK:** sem acesso direto. Duas opções abaixo.

### Tarefas para OpenRouter

1. Em `OpenRouterProvider.ts:437-453`, quando o modelo for Anthropic (detectar via `model.includes('anthropic/')`), montar o system message como array de blocks:
   ```typescript
   messages: [
     {
       role: 'system',
       content: [
         { type: 'text', text: buildSystemPrompt(mode), cache_control: { type: 'ephemeral' } }
       ]
     },
     ...userMessages
   ]
   ```
2. Para modelos não-Anthropic em OpenRouter, manter `content: string` (Fase 2 já feita).

**Documentação:** https://openrouter.ai/docs/features/prompt-caching → "Anthropic Claude" section. Copiar formato exato.

### Tarefas para Claude (via agent SDK)

**Opção A (recomendada, baixo risco):** confiar no caching automático do processo Claude Code spawned pelo agent SDK. Validar que system_identity está estável entre turnos passando-o no `customSystemPrompt` se a opção existir.

- Investigar `node_modules/@anthropic-ai/claude-agent-sdk/dist/*.d.ts` para `customSystemPrompt`, `systemPrompt`, ou similar em `QueryOptions`. **Tarefa de descoberta antes do código.**
- Se existir: usar `buildSystemPrompt(mode)` em vez de prepender ao `userPrompt`.
- Se não existir: deixar como está. Caching implícito ainda ocorre porque o init prompt é repetido entre sessões consecutivas (mesmo project).

**Opção B (maior refactor, melhor controle):** trocar ClaudeProvider para `@anthropic-ai/sdk` raw `messages.create` com `cache_control: {type: 'ephemeral'}`. **Não fazer nesta fase** — escopo grande, perde features do agent SDK (resume, MCP, etc.). Registrar como issue futuro.

### Verificação

- OpenRouter: enviar request, verificar `usage.cache_creation_input_tokens` (1º turno) e `usage.cache_read_input_tokens` > 0 (2º+ turno).
- Claude SDK: medir custo de uma sessão com 30 obs antes/depois. Esperar redução de 30-50% em input tokens cacheáveis.

### Anti-padrões

- ❌ Aplicar `cache_control` em mensagens user (turno-a-turno) → cache nunca atinge — system muda nunca = certo, user muda sempre.
- ❌ Múltiplos `cache_control` breakpoints sem propósito. Anthropic permite até 4 — usar 1 só no fim do system.
- ❌ Trocar ClaudeProvider para SDK raw nesta fase. Refactor separado.

---

## Fase 4 — Enxugar `code.json` (mode prompt)

**Complementar — atinge mesmo que prompt caching, mas multiplica savings.**

### O que implementar

`plugin/modes/code.json` tem ~10KB. Reduzir para ~5KB sem perder signal.

### Tarefas

1. Em `plugin/modes/code.json`:
   - Remover `format_examples` quando vazio (já é `""`, ok).
   - Consolidar `type_guidance` (linha 106) — duplica `observation_types[].id+description`. Trocar por gerador no `buildInitPrompt`.
   - Consolidar `concept_guidance` (linha 107) — idem com `observation_concepts`.
   - Comprimir `recording_focus` (linha 104) — remover 2 dos 5 GOOD/BAD examples. Manter 1 de cada.
   - Comprimir `footer` (linha 111) — manter 1 frase imperativa; remover "Thank you so much for your help" e variantes.
2. Em `src/sdk/prompts.ts:buildInitPrompt` (e `buildSystemPrompt` da Fase 2): gerar `type_guidance` e `concept_guidance` programaticamente a partir de `mode.observation_types` e `mode.observation_concepts`.
3. Aplicar mesma compressão nas variantes de idioma (`code--pt-br.json`, `code--es.json`, etc.) — script de migração ou edit manual coordenado.

### Verificação

- `wc -c plugin/modes/code.json` → ~5KB (era 10KB).
- Rodar 1 sessão real após Fase 4, verificar tipo/qualidade de observações geradas — comparar com sample pré-mudança. Sem regressão em diversidade de `type` ou estrutura XML.
- Snapshot do `buildSystemPrompt(modeCode)` antes/depois pra confirmar estabilidade.

### Anti-padrões

- ❌ Remover `system_identity` ou `observer_role` — são cruciais para tom e foco.
- ❌ Encurtar a ponto de modelo pequeno (phi4) perder formato XML. Testar com Ollama+phi4 antes de aprovar.

---

## Fase 5 — Verificação ponta a ponta

### Métricas a coletar

Para cada provider configurável, rodar sessão controlada (script `npm run repro-session` se existir, senão manualmente):

| Métrica | Antes | Depois | Fonte |
|---|---|---|---|
| Tokens de input por turno (médio) | ? | ? | logs do worker (`worker.log`) |
| Tokens cache_hit / turno (≥2) | 0 | > 50% do input | DeepSeek/OpenRouter `usage` |
| Linhas em `pending_messages` por sessão | baseline | -30% a -50% | sqlite query |
| Observações geradas por sessão | baseline | ≈ igual ou ligeiramente menor | sqlite query |
| Diversidade de `type` | baseline | ≈ igual | sqlite query |
| Custo USD estimado por sessão (DeepSeek) | baseline | -40% a -70% | calculadora interna se existe |

### Checklist final

- [ ] Fase 1 ON: `grep -n "PREFILTER_ENABLED" src/shared/SettingsDefaultsManager.ts` retorna match.
- [ ] Fase 2 ON: `grep -rn "role: 'system'" src/services/worker/*Provider.ts` retorna ≥3 matches.
- [ ] Fase 3 ON: OpenRouter envia `cache_control` (`grep -n "cache_control" src/services/worker/OpenRouterProvider.ts`).
- [ ] Fase 4 ON: `code.json` <6KB.
- [ ] Tests: `npm test` verde.
- [ ] Build: `npm run build-and-sync` sem erros.
- [ ] Worker reinicia: `curl http://127.0.0.1:<port>/health` retorna 200.
- [ ] Sessão real: 1 sessão de 10+ tool_uses, observações geradas via DeepSeek com `prompt_cache_hit_tokens` no log.
- [ ] Nenhuma regressão em `mem-search` (query manual retorna obs recentes).

### Grep guards (anti-pattern check)

```bash
# Nunca cache_control em mensagem user
! grep -rn "role.*user.*cache_control\|cache_control.*role.*user" src/services/worker/

# Nunca timestamp dinâmico em buildSystemPrompt
! grep -n "Date.now\|new Date\|toISOString" src/sdk/prompts.ts | grep -A2 "buildSystemPrompt"

# Filtro só em shared.ts
grep -rln "decidePrefilter" src/ | wc -l  # esperar 2: PrefilterDecider.ts + shared.ts
```

---

## Sequência recomendada de PRs

1. **PR 1 — Fase 1** (pré-filtro). Independente, mensurável. Merge solo.
2. **PR 2 — Fase 2** (system separation). Refactor de providers OpenAI-compatible + Gemini. Não toca ClaudeProvider.
3. **PR 3 — Fase 3** (cache markers OpenRouter + descoberta Claude SDK).
4. **PR 4 — Fase 4** (enxugar mode).
5. **PR 5 — Fase 5** (métricas + checklist).

---

## Notas

- Manter feature flags (`CLAUDE_MEM_PREFILTER_ENABLED`, etc.) por 1 release antes de remover.
- Atualizar `docs/public/` se mudanças afetam API pública ou settings visíveis.
- Sem mudança em `CHANGELOG.md` (auto-gerado, ver `CLAUDE.md`).
