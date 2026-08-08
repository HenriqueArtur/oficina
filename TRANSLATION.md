# Translating the viewer into the package

The viewer works, and it is written in Portuguese. This file fixes the naming
so the move is mechanical instead of a series of small judgement calls made
twice.

## Why it is not a find-and-replace

The viewer currently lives in the study repository and is imported by it. A
rename that lands halfway leaves **both** repositories broken: the study repo
loses its viewer, and the package has a module that references names that no
longer exist. It has to be one pass, verified by the 420 tests that already
cover the behaviour.

Scope: ~2,800 lines across eight files, and 53 identifiers.

## The glossary

Chosen once, here, so nobody has to choose twice.

| Portuguese | English | note |
|---|---|---|
| `lerProjetos` | `readLessons` | "project" is this subject's word; the shell says lesson |
| `lerNotas` / `escreverNotas` | `readNotes` / `writeNotes` | |
| `lerReferencias` | `readReferences` | |
| `lerInventario` | — | gone; it belongs to the inventory plugin |
| `montarMenu` | `buildMenu` | |
| `montarAbas` | `buildTabs` | |
| `montarIndice` | `buildPageIndex` | the section list, not a home page |
| `pagina` | `renderPage` | it renders; it is not a noun |
| `paginaInicial` | `renderHome` | |
| `paginaProjeto` | `renderLesson` | |
| `paginaReferencia` | `renderReference` | |
| `editorDeNotas` | `notesEditor` | |
| `comAncoras` | `withAnchors` | |
| `comBotaoDeCopiar` | `withCopyButtons` | |
| `separarSecoes` / `juntarSecoes` | `splitSections` / `joinSections` | |
| `apelido` | `slugify` | the usual word for it |
| `escapar` | `escapeHtml` | plain `escape` shadows the global |
| `rota` | `handleRequest` | `route` is the noun; this is the handler |
| `cor` | `paint` | `color` reads as data, this is terminal output |
| `Projeto` | `Lesson` | already the name in the contract |
| `Notas` | `Notes` | |
| `Secao` | `Section` | |
| `Referencia` | `Reference` | |
| `Achado` | `Finding` | already used in the plugins |
| `RAIZ` | — | gone; paths come from `process.cwd()` |
| `DIR_PROJETOS` / `DIR_MEU` | from config | `content.lessons` / `content.mine` |
| `STATUS_VALIDOS` | `NOTE_STATUSES` | |
| `SECOES_DAS_NOTAS` | from config | `notes.sections` |
| `ABAS` | `TABS` | |

## What must change beyond names

- **Hardcoded strings.** Every one goes through `config.labels`; the shell
  ships English defaults and a repository overrides what it needs.
- **Folder names.** `projetos/`, `referencia/`, `meu/` come from
  `config.content`, never from a constant.
- **`estudo.config.json`** becomes `bancada.config.json`.
- **The plugin bridge.** The shell must stop importing anything under
  `plugins/`; it already loads them through `loadPlugins`, so what is left is
  deleting the two convenience imports.

## The order that keeps both repos working

1. translate inside the study repository, tests green at every step
2. move the translated modules into `bancada/src`
3. in the study repository, install `bancada` and delete `scripts/`
4. one commit on each side, pushed together

Step 3 is the one that must not be split: between deleting the local copy and
installing the package, the study repository has no viewer.
