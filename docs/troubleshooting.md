# Troubleshooting

## 2026-06-10 — Worker preso em "healthy but not ready" após restart

**Sintoma**: Claude Code bloqueava UserPromptSubmit com "No stderr output". Hooks (`session-init`, `observation`) estouravam timeout (>15s) sem resposta.

**Causa raiz**: Worker sofreu `database is locked` durante inicialização às 21:55 (erro visível em `~/.claude-mem/logs/claude-mem-2026-06-11.log`). O worker iniciou mas nunca atingiu estado "ready" — respondia health check mas recusava hook API calls com "Worker is healthy but not ready; skipping hook API call".

**Solução aplicada**:
1. `kill 89871` — matar o worker daemon travado
2. `pkill -f "worker-service.cjs hook claude-code"` — matar hooks pendurados
3. `rm ~/.claude-mem/CAPTURE_BROKEN ~/.claude-mem/worker.pid` — limpar artefatos de falha
4. `ollama serve` — iniciar Ollama (estava parado; embedding model `nomic-embed-text` depende dele)
5. Worker reinicia automaticamente na próxima sessão do Claude Code

**Verificação**: `lsof ~/.claude-mem/claude-mem.db` sem locks. Ollama rodando, `nomic-embed-text` disponível.

**Recorrência**: se acontecer de novo, verificar `~/.claude-mem/logs/` pelos erros `database is locked` ou `Background initialization failed`. Matar worker e limpar `worker.pid` costuma resolver.
