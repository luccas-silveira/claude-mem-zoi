# claude-mem × ZOI Design System — Adaptation Brief

**Data:** 2026-05-06
**Versão DS:** `@zoitechnologies/ds@1.0.2`
**Escopo:** Viewer React (`src/ui/viewer/`) + WelcomeCard ANSI terminal

---

## 1. Contexto

claude-mem hoje carrega Clash Display via Fontshare e usa `#b5ff81` (mesmo verde brand ZOI) mas com tokens redefinidos manualmente em `src/ui/viewer-template.html`. Resultado: drift garantido contra `@zoitechnologies/ds`. Este brief alinha 100% ao DS oficial.

## 2. Inventário do DS

**Brand colors**
- `--green-400: #b5ff81` (primary)
- `--green-500: #90cc67` (primary hover)
- `--green-900: #364c26` (dark)
- `--magenta-500: #cc3366` (accent)

**Neutrals** `--neutral-0` … `--neutral-900` (10 stops)
**System** `--system-error #e53935` · `--system-success #43a047` · `--system-warning #fb8c00`
**Spacing** `--space-1` (4px) … `--space-25` (100px), rem-based
**Radius** `--radius-sm` 4px · `--radius-md` 12px · `--radius-lg` 16px · `--radius-full` 9999px
**Fonts** Clash Display (display, 200-700) + system body
**Motion** `--duration-fast` 150ms · `--duration-normal` 300ms · `--ease-out` · `--ease-in-out`
**Z-index** base / sticky 100 / overlay 1000 / modal 1100
**Components** `.btn`, `.btn-primary/secondary/outline/sm`, `.card`, `.card-dark`, `.form-input`, `.form-label`, `.form-group`, `.container`, `.grid-2/3`

**Dark theme** (extraído de `styleguide/index.html:36`, ainda não em `styles/theme.css`):
- `--bg-page: linear-gradient(135deg, #0a0f0a, #141414, #0d1f0d)` (gradient verde-escuro)
- `--bg-surface: rgba(30,30,30,0.9)` · `--bg-surface-hover: rgba(35,35,35,0.9)`
- `--text-primary: #e0e0e0` · `--text-secondary: #a0a0a0`
- `--border-default: rgba(255,255,255,0.08)`
- `--glow-green: rgba(181,255,129,0.12)` · `--glow-green-strong: rgba(181,255,129,0.25)` ← signature

## 3. Decisões de design (grill-me consolidado)

| # | Decisão | Escolha | Racional curto |
|---|---------|---------|----------------|
| 1 | Identidade | `@zoitechnologies/ds@1.0.2` | Já instalado, single source of truth |
| 2 | Escopo | Viewer React + WelcomeCard terminal | UI principal + ponto de contato terminal |
| 3 | Dark mode | Sim, manter toggle | UX dev essencial |
| 3.5 | Origem dark tokens | Copiar styleguide → `theme-dark.css` local + issue DS | Desbloqueia já, documenta dívida |
| 4 | Build | Inline import via `build-viewer.js` (theme.css + theme-dark.css → `<style>`) | Single HTML, zero fetch runtime, sync auto |
| 5 | Cores semânticas | observation=neutral-700, prompt=green-400, summary=magenta-500 | 100% paleta DS, mantém scanning visual |
| 6 | Tipografia | Clash em headings + botões + chrome; system body | DS oficial; leitura preserva |
| 7 | Cards | Tokens DS, classes próprias (não reescrever) | Comportamentos custom (collapse, hover-grow, agent-grouping) preservados |
| 8 | Motion | Sweep total para `--duration-*` + `--ease-*` | Brand identity completa |
| 9 | Header | ZOI logo + tagline "claude-mem" | ZOI primeiro, produto secundário |
| 10 | WelcomeCard ANSI | Truecolor RGB com paleta DS + fallback ASCII box | Universal moderno + terminais antigos |
| 11 | Forms | Tokens DS, classes próprias | Coerente com decisão de cards |
| 12 | Glow dark | Seletivo: botão hover, focus ring, accent borders | Signature sem virar Christmas tree |
| 13 | Spacing/radius | Sweep só superfícies grandes (cards/modais/header) | 80% benefício / 20% custo |
| 14 | Default theme | `prefers-color-scheme` + localStorage | Respeita sistema do dev |
| 15 | Migração | 6 commits atômicos faseados | Reverts cirúrgicos se quebrar |
| 16 | Done | Checklist objetiva + smoke test fluxo real | Evita "parece bom vazio mas quebra com 50 obs" |

## 4. Mapeamento de cores semânticas

| Tipo | Light | Dark | Token |
|------|-------|------|-------|
| observation | `--neutral-700 #3f444b` border, `--neutral-50` bg | `--neutral-700` border, surface dark | `--ext-card-observation-*` |
| prompt | `--green-400 #b5ff81` border, `--neutral-50` bg | `--green-400` border + glow | `--ext-card-prompt-*` |
| summary | `--magenta-500 #cc3366` border, `--neutral-50` bg | `--magenta-500` border | `--ext-card-summary-*` |

Tokens semânticos derivados (`--ext-card-*-bg`, `--ext-card-*-border`, `--ext-card-*-fg`) compõem a partir de tokens DS oficiais.

## 5. Plano de commits

1. `feat(viewer): inline @zoitechnologies/ds theme.css + dark theme-dark.css via build script`
   - `scripts/build-viewer.js` lê `node_modules/@zoitechnologies/ds/styles/theme.css`
   - Extrai bloco `[data-theme="dark"]` do styleguide.html
   - Injeta consolidado dentro do `<style>` do template
   - Adiciona comentário `/* DS v1.0.2 — embedded by build-viewer.js */`

2. `refactor(viewer): replace hardcoded colors/radius/spacing with DS tokens (cards, modals, header)`
   - Sweep `viewer-template.html`: hex colors → `var(--*)`
   - Cards (Observation/Prompt/Summary/Welcome) usam novos `--ext-card-*` tokens
   - Modais (ContextSettings/Logs) usam `--bg-surface`, `--border-default`, `--radius-md`
   - Header usa `--bg-page`, `--text-primary`

3. `feat(viewer): ZOI logo + claude-mem tagline in header`
   - `Header.tsx`: `<img src="zoi-logo.png" /> · claude-mem`
   - Logo 28px altura, tagline em `Clash Display 500`
   - Mantém `GitHubStarsButton`, `ThemeToggle`

4. `refactor(viewer): adopt DS motion tokens (duration + easing) across transitions`
   - Sweep regex `[0-9]+ms` → `var(--duration-fast)` ou `var(--duration-normal)`
   - `ease-in-out` literal → `var(--ease-in-out)`
   - Validar hover/focus/expand/collapse animam conforme

5. `feat(viewer): selective green glow on dark mode (button hover, focus, accent borders)`
   - `[data-theme="dark"] .btn-primary:hover { box-shadow: 0 0 20px var(--glow-green-strong) }`
   - `[data-theme="dark"] :focus-visible { box-shadow: 0 0 0 3px var(--glow-green-strong) }`
   - Cards selecionados/ativos: glow sutil `var(--glow-green)`

6. `feat(welcome): truecolor ANSI with DS palette + ASCII fallback`
   - `WelcomeCard.tsx` (server-side render ANSI):
     ```
     COLORTERM === 'truecolor' → \x1b[38;2;181;255;129m (green-400)
     fallback → ASCII box, sem cor ou ANSI 8-bit aproximado
     ```
   - ZOI ASCII art logo + bordas verde brand

## 6. Critério de aceitação ("done")

**Checklist objetiva:**
- [ ] Zero hex colors hardcoded fora do bloco DS importado em `viewer-template.html`
- [ ] Clash Display aplicada em h1-h6 + `.btn` + `.logo-text`
- [ ] Toggle dark/light alterna `[data-theme]`, glow aparece só dark
- [ ] Header mostra ZOI logo + "claude-mem"
- [ ] WelcomeCard renderiza com cores brand em terminal truecolor
- [ ] `grep -E "[0-9]+px" src/ui/viewer-template.html` retorna apenas detalhes finos (≤8px) fora da escala DS
- [ ] Cards observation/prompt/summary diferenciam visualmente sem sair da paleta DS

**Smoke test:**
- [ ] `npm run build-and-sync` (sem queue:clear) compila sem erros
- [ ] Worker reinicia e serve `http://127.0.0.1:37701`
- [ ] Sessão real gera ≥1 observation, ≥1 prompt, ≥1 summary
- [ ] Cards renderizam tokens DS corretos em ambos themes
- [ ] WelcomeCard aparece colorido no terminal de teste

## 7. Dependências externas

- **Issue ZOI DS:** mover bloco `[data-theme="dark"]` de `styleguide/index.html` para `styles/theme-dark.css` exportável. Sem isso, sync manual. Tracker: TBD.
- **Logo ZOI SVG:** DS não fornece. Usando `src/ui/viewer/assets/zoi-logo.png` local. Idealmente DS exporta SVG no futuro.

## 8. Não-objetivos

- Mintlify docs site — escopo separado
- ANSI hooks fora de WelcomeCard — fora de escopo
- Tailwind preset — viewer não usa Tailwind, preset não aplica
- Reescrever `ObservationCard.tsx`, `PromptCard.tsx`, `SummaryCard.tsx`, `WelcomeCard.tsx` arquitetura — só substituir tokens
