import { join } from "node:path";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import ini from "highlight.js/lib/languages/ini";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import {
  type Content,
  contentFrom,
  joinSections,
  type LessonFile,
  type Notes,
  type Reference,
  readLessons,
  readNotes,
  readReferences,
  splitSections,
  writeNotes,
} from "./content.ts";
import { loadPlugins } from "./loader.ts";
import {
  type Asset,
  applyStage,
  type Config,
  collect,
  fill,
  type Labels,
  type Lesson,
  type MenuItem,
  type Registry,
  type Route,
  TAB_IDS,
  type TabConfig,
} from "./plugin.ts";
import { DEFAULT_FONT, DEFAULT_THEME, FONTS, THEMES, themeCss } from "./themes.ts";

/** Today in short ISO, to stamp a note the first time it leaves "not started". */
const today = () => new Date().toISOString().slice(0, 10);

// Only the languages this repository uses. The full highlight.js bundle
// carries ~190 and weighs about 10x more for nothing.
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ini", ini); // toml cai aqui
hljs.registerLanguage("plaintext", plaintext);

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, language) {
      // A fence with no language, or one we did not register, comes out as
      // plain text — never as an error. An ugly code block beats a 500.
      const known = hljs.getLanguage(language) ? language : "plaintext";
      return hljs.highlight(code, { language: known }).value;
    },
  }),
);

/**
 * Everything one viewer needs, resolved once.
 *
 * Built by `createViewer`, never at import time: importing a module must not
 * read a file, and two repositories in one process must not share state.
 */
export interface Viewer {
  config: Config;
  content: Content;
  plugins: Registry;
  styles: string;
  scripts: string[];
  assets: Map<string, Asset>;
  menu: MenuItem[];
  routes: Route[];
  statusIds: string[];
  statusLabel: Map<string, string>;
  /** What a note carries before anyone has touched it. */
  firstStatus: string;
  /** The status the home progress counts, if the repository named one. */
  doneStatus?: string;
  statusMark: Map<string, string>;
  tabLabel: Record<string, string>;
  /** The declared tabs, in order — `config.tabs`, resolved once. */
  tabs: TabConfig[];
  /** Tab id → the file it edits. Only the tabs that asked to be editable. */
  editable: Map<string, string>;
  notesEnabled: boolean;
  handleRequest: (req: Request, opts?: { ip?: string }) => Promise<Response>;
}

export async function createViewer(config: Config, root: string = process.cwd()): Promise<Viewer> {
  const content = contentFrom(config, root);
  const plugins = await loadPlugins(config, root);
  const statuses = config.notes.statuses;

  const v: Viewer = {
    config,
    content,
    plugins,
    styles: (await collect(plugins, "styles", null)).join("\n"),
    scripts: await collect(plugins, "scripts", null),
    // Served from an allowlist, and the list comes from the plugins. Building
    // the path out of the URL would make `/assets/../x` a case to handle; as
    // a map, it is simply a name that is not there.
    assets: new Map((await collect(plugins, "assets", null)).map((a: Asset) => [a.name, a])),
    menu: await collect(plugins, "menuItems", null),
    routes: await collect(plugins, "routes", null),
    statusIds: statuses.map((s) => s.id),
    statusLabel: new Map(statuses.map((s) => [s.id, s.label])),
    firstStatus: statuses[0]?.id ?? "",
    doneStatus: statuses.find((s) => s.done)?.id,
    statusMark: new Map(statuses.filter((s) => s.mark).map((s) => [s.id, s.mark as string])),
    tabLabel: {
      lesson: config.labels.lesson,
      exercises: config.labels.exercises,
      notes: config.labels.myNotes,
    },
    tabs: config.tabs,
    // `notes` writes through its own endpoint and its own shape, so it is not
    // in this map even if a config marks it editable.
    editable: new Map(
      config.tabs
        .filter((t) => t.editable && t.id !== "notes")
        .map((t) => [
          t.id,
          t.id === "exercises" ? config.content.exercisesFile : config.content.lessonFile,
        ]),
    ),
    notesEnabled: config.tabs.some((t) => t.id === "notes"),
    handleRequest: () => Promise.reject(new Error("unreachable")),
  };

  v.handleRequest = (req, opts = {}) => handleRequest(v, req, opts);
  return v;
}

/**
 * The lesson, in the shape the plugins receive.
 *
 * `front` is keyed the way the repository writes its frontmatter, not the way
 * the type names its fields: a plugin's `key` setting points at the author's
 * word, and this is where the two have to agree.
 */
const asLesson = (v: Viewer, p: LessonFile): Lesson => {
  const front = v.config.frontmatter;
  return {
    id: p.folder,
    title: p.title,
    level: p.level,
    requires: p.requires,
    path: p.path,
    front: { [front.parts]: p.parts, [front.pins]: p.pins, [front.concepts]: p.concepts },
    body: p.body,
  };
};

/**
 * The tab ids. Stable English ids, not display text: they go in the URL and
 * the server dispatches on them, so translating the page must not change
 * which link opens what.
 *
 * Which of them a given repository shows is `config.tabs`; this is the closed
 * set the config is checked against.
 */
export const TABS = TAB_IDS;

export type Tab = (typeof TABS)[number];

/** One entry of the on-this-page index. */
export interface Section {
  id: string;
  text: string;
  level: number;
}

/** "Quando não funciona" -> "quando-nao-funciona" */
export function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira os acentos separados pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Puts ids on the h2/h3 of the HTML and returns the section list for the
 * index. Both come out of the same pass on purpose: anchors and index
 * generated separately drift apart, and a link that leads nowhere is worse
 * than having no index at all.
 */
export function withAnchors(html: string): { html: string; sections: Section[] } {
  const sections: Section[] = [];
  const used = new Map<string, number>();

  const marked = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const base = slugify(text) || "section";

    // Two identical headings on the same page would produce the same
    // anchor, and every click would land on the first one.
    const times = used.get(base) ?? 0;
    used.set(base, times + 1);
    const id = times === 0 ? base : `${base}-${times + 1}`;

    sections.push({ id, text, level: Number(level) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  return { html: marked, sections };
}

/**
 * Wraps each `<pre>` block and adds the copy button.
 * Fenced blocks only: inline code is a function name, not a program to copy.
 */
export function withCopyButtons(html: string, labels: Pick<Labels, "copy" | "copyCode">): string {
  return html.replace(
    /<pre>([\s\S]*?)<\/pre>/g,
    (_, inner: string) =>
      `<div class="code-block">` +
      `<button class="copy" type="button" aria-label="${escapeHtml(labels.copyCode)}">` +
      `${escapeHtml(labels.copy)}</button>` +
      `<pre>${inner}</pre></div>`,
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderPage(v: Viewer, title: string, menu: string, body: string, toc = ""): string {
  return `<!doctype html>
<html lang="${escapeHtml(v.config.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>
// In <head> and synchronous on purpose: applied after the first paint, a
// dark theme flashes white on every navigation.
(() => {
  const r = document.documentElement;
  r.dataset.theme = localStorage.getItem("theme") || ${JSON.stringify(DEFAULT_THEME)};
  r.dataset.font = localStorage.getItem("font") || ${JSON.stringify(DEFAULT_FONT)};
})();
</script>
<style>
${themeCss()}

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.7 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    display: grid; grid-template-columns: 270px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  header {
    grid-column: 1 / -1; position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: .6rem;
    padding: .55rem 1.1rem; background: var(--surface);
    border-bottom: 1px solid var(--border);
    font: 13px/1 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  header .brand { font-weight: 600; color: var(--text); text-decoration: none; }
  header .prefs { margin-left: auto; display: flex; align-items: center; gap: .45rem; }
  header label { color: var(--muted); font-size: 12px; }
  header select {
    font: 12px/1 inherit; padding: .35rem .5rem; cursor: pointer;
    color: var(--text); background: var(--bg);
    border: 1px solid var(--border); border-radius: 5px;
  }
  header select:hover { border-color: var(--muted); }
  header select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  nav {
    border-right: 1px solid var(--border); padding: 1.6rem 1.1rem;
    height: calc(100vh - var(--header-h)); overflow-y: auto;
    position: sticky; top: var(--header-h);
    background: var(--surface); font-size: 14px;
  }
  nav h1 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em;
           color: var(--muted); margin: 0 0 1rem; font-weight: 600; }
  nav a { display: block; padding: .34rem .5rem; border-radius: 5px;
          color: var(--text); text-decoration: none; }
  nav a:hover { background: var(--code-bg); }
  nav a.active { background: var(--accent); color: #fff; }
  nav .num { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: .45rem; }
  nav a.active .num { color: #fff; opacity: .75; }
  /* a fonte escolhida vale para o TEXTO; menu e botões seguem na do sistema */
  main {
    padding: 2.6rem 3rem; max-width: 62rem; overflow-x: hidden;
    font-family: var(--reading-font, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
  }
  main code, main pre, main .zoom-level { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .tabs { display: flex; gap: .4rem; border-bottom: 1px solid var(--border);
          margin-bottom: 2rem; }
  .tabs a { padding: .5rem .9rem; text-decoration: none; color: var(--muted);
            border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs a.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { font-size: 1.9rem; margin-top: 0; }
  h2 { margin-top: 2.4rem; border-bottom: 1px solid var(--border); padding-bottom: .35rem; }
  a { color: var(--accent); }
  pre { background: var(--code-bg); padding: 1rem 1.1rem; border-radius: 7px;
        overflow-x: auto; font-size: 14px; line-height: 1.55; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .92em; }
  :not(pre) > code { background: var(--code-bg); padding: .13em .38em; border-radius: 4px; }

  /* ── destaque de sintaxe ──────────────────────────────────────────
     As cores vêm do tema; aqui só o mapeamento cls -> variável. */
  pre code.hljs { background: none; padding: 0; display: block; }

  .code-block { position: relative; }
  .code-block pre { margin: 1.2rem 0; }
  .copy {
    position: absolute; top: .55rem; right: .55rem; z-index: 1;
    font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: .03em; padding: .42rem .6rem; cursor: pointer;
    color: var(--muted); background: var(--surface);
    border: 1px solid var(--border); border-radius: 5px;
    opacity: 0; transition: opacity .13s, color .13s, border-color .13s;
  }
  /* aparece no hover do bloco, e sempre que receber foco por teclado —
     um botão que só exists no hover é um botão que o teclado não alcança */
  .code-block:hover .copy, .copy:focus-visible { opacity: 1; }
  .copy:hover { color: var(--text); border-color: var(--muted); }
  .copy.done { opacity: 1; color: var(--code-string); border-color: var(--code-string); }
  @media (hover: none) { .copy { opacity: 1; } }

${v.styles}
  .actions { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; }

  .copy-file {
    font: 600 12px/1 ui-monospace, "SF Mono", Menlo, monospace;
    padding: .5rem .7rem; cursor: pointer; border-radius: 5px;
    color: var(--text); background: var(--code-bg);
    border: 1px solid var(--border);
    transition: border-color .13s, color .13s;
  }
  .copy-file::before { content: "⧉ "; color: var(--muted); }
  .copy-file:hover { border-color: var(--accent); color: var(--accent); }
  .copy-file.done {
    color: var(--code-string); border-color: var(--code-string);
  }
  .copy-file.done::before { content: "✓ "; color: var(--code-string); }
  .hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-operator {
    color: var(--code-keyword); font-weight: 600; }
  .hljs-string, .hljs-attribute { color: var(--code-string); }
  .hljs-number, .hljs-literal, .hljs-symbol { color: var(--code-number); }
  .hljs-title, .hljs-title.function_, .hljs-section { color: var(--code-function); }
  /* #define e #include são metade de um sketch Arduino */
  .hljs-meta, .hljs-meta .hljs-keyword { color: var(--code-meta); }
  .hljs-meta .hljs-string { color: var(--code-string); }
  .hljs-type, .hljs-built_in, .hljs-class .hljs-title { color: var(--code-type); }
  .hljs-variable, .hljs-params, .hljs-attr { color: inherit; }
  .hljs-name { color: var(--code-function); }
  .hljs-deletion { color: var(--code-number); }
  .hljs-addition { color: var(--code-string); }
  blockquote { border-left: 3px solid var(--accent); margin: 1.4rem 0;
               padding: .1rem 0 .1rem 1.1rem; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--border); padding: .5rem .75rem; text-align: left; }
  th { background: var(--code-bg); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 2.4rem 0; }
  .badge { display: inline-block; font-size: 12px; padding: .1rem .5rem;
          border-radius: 20px; border: 1px solid var(--border); color: var(--muted); }
  .part { display: flex; justify-content: space-between; gap: 1rem;
          padding: .45rem 0; border-bottom: 1px solid var(--border); }
  .part:last-child { border-bottom: 0; }
  .card { background: var(--surface); border: 1px solid var(--border);
            border-radius: 9px; padding: 1.1rem 1.3rem; margin-bottom: 1.4rem; }
  .card h3 { margin-top: 0; font-size: 14px; text-transform: uppercase;
               letter-spacing: .07em; color: var(--muted); }

  /* ── editor das notes ─────────────────────────────────────────────
     Mora aqui, e não num plugin: notes são da casca. Este bloco estava
     na eletrônica, e um repositório sem aquele plugin ficava com o
     editor sem estilo nenhum. */
  .outside-template { font-size: 13px; color: var(--muted); margin: -.4rem 0 1.4rem; }
  .note-field { margin-bottom: 1.4rem; }
  .note-field label {
    display: block; margin-bottom: .4rem;
    font: 600 13px/1.3 ui-sans-serif, system-ui, sans-serif;
    color: var(--text);
  }
  .note-field label::before { content: "## "; color: var(--muted); font-weight: 400; }
  .editor textarea {
    width: 100%; min-height: 7rem; resize: vertical; padding: .8rem 1rem;
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px;
    font: 14px/1.65 ui-monospace, "SF Mono", Menlo, monospace;
  }
  .editor textarea:focus { outline: none; border-color: var(--accent); }
  .status-row {
    display: flex; align-items: center; flex-wrap: wrap; gap: .4rem;
    margin-bottom: .9rem;
  }
  .status-row .label {
    font-size: 12px; text-transform: uppercase; letter-spacing: .07em;
    color: var(--muted); margin-right: .3rem; font-weight: 600;
  }
  .status-button {
    cursor: pointer; padding: .4rem .75rem; border-radius: 20px;
    font: 13px/1 ui-sans-serif, system-ui, sans-serif;
    color: var(--muted); background: none; border: 1px solid var(--border);
    transition: color .12s, border-color .12s, background .12s;
  }
  .status-button:hover { color: var(--text); border-color: var(--muted); }
  .status-button.active {
    color: #fff; background: var(--accent); border-color: var(--accent);
    font-weight: 600;
  }
  .editor-row { display: flex; align-items: center; gap: .8rem; margin-top: .7rem; }
  .save-notes, .save-file {
    cursor: pointer; padding: .5rem 1.1rem; border-radius: 6px; font-weight: 600;
    font-size: 13px; color: #fff; background: var(--accent); border: 0;
  }
  .save-notes:hover, .save-file:hover { filter: brightness(1.08); }

  /* the editor on an editable tab: the file as it reads, or as it is written */
  .file-editor > .editor-row { margin: 0 0 1.2rem; }
  .edit-file {
    cursor: pointer; padding: .4rem .9rem; border-radius: 6px;
    font: 13px/1 ui-sans-serif, system-ui, sans-serif;
    color: var(--muted); background: none; border: 1px solid var(--border);
    transition: color .12s, border-color .12s;
  }
  .edit-file:hover { color: var(--text); border-color: var(--muted); }
  .file-editor textarea.raw {
    width: 100%; min-height: 25rem; resize: vertical; padding: 1rem 1.1rem;
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 7px;
    font: 14px/1.7 ui-monospace, "SF Mono", Menlo, monospace;
  }
  .file-editor textarea.raw:focus { outline: none; border-color: var(--accent); }
  .hint { font-size: 12px; color: var(--muted); }
  .saved { font-size: 12px; color: var(--code-string); font-weight: 600; }
  .saved.bad { color: var(--accent); }

  :root { --header-h: 46px; }
  html { scroll-behavior: smooth; }
  h2[id], h3[id] { scroll-margin-top: calc(var(--header-h) + 1rem); }

  body.with-toc { grid-template-columns: 270px minmax(0, 1fr) 230px; }
  .toc {
    height: calc(100vh - var(--header-h)); overflow-y: auto;
    position: sticky; top: var(--header-h);
    padding: 2.6rem 1.2rem 2rem 0; font-size: 13px;
    border-left: 1px solid var(--border);
  }
  .toc h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .09em;
               color: var(--muted); margin: 0 0 .8rem 1rem; border: 0;
               padding: 0; font-weight: 600; }
  .toc .section {
    display: block; padding: .28rem 0 .28rem 1rem; text-decoration: none;
    color: var(--muted); border-left: 2px solid var(--border);
    line-height: 1.4; transition: color .12s, border-color .12s;
  }
  .toc .section:hover { color: var(--text); }
  .toc .section.n3 { padding-left: 1.9rem; font-size: 12px; }
  .toc .section.here {
    color: var(--accent); border-left-color: var(--accent); font-weight: 600;
  }

  @media (max-width: 1100px) {
    body.with-toc { grid-template-columns: 270px minmax(0, 1fr); }
    .toc { display: none; }
  }
  @media (max-width: 800px) {
    body, body.with-toc { grid-template-columns: 1fr; }
    header { position: static; }
    header label { display: none; }
    nav { height: auto; position: static; border-right: 0;
          border-bottom: 1px solid var(--border); }
    main { padding: 1.6rem 1.2rem; }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
</head>
<body class="${toc ? "with-toc" : ""}">
<header>
  <a class="brand" href="/">${escapeHtml(v.config.title)}</a>
  <div class="prefs">
    <label for="font">${escapeHtml(v.config.labels.font)}</label>
    <select id="font" aria-label="${escapeHtml(v.config.labels.fontAria)}">${FONTS.map(
      (f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`,
    ).join("")}</select>
    <label for="theme">${escapeHtml(v.config.labels.theme)}</label>
    <select id="theme" aria-label="${escapeHtml(v.config.labels.themeAria)}">${THEMES.map(
      (t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`,
    ).join("")}</select>
  </div>
</header>
<nav>${menu}</nav>
<main>${body}</main>
${toc}
${
  body.includes('class="card"')
    ? [...v.assets.values()].map((a) => `<script src="/assets/${a.name}"></script>`).join("\n") +
      v.scripts.map((js) => `<script>${js}</script>`).join("\n")
    : ""
}
<script>
// ── preferences: theme and font ─────────────────────────────────────
(() => {
  const raiz = document.documentElement;
  for (const [chave, campo] of [["theme", document.getElementById("theme")],
                                ["font", document.getElementById("font")]]) {
    if (!campo) continue;
    campo.value = raiz.dataset[chave];
    campo.addEventListener("change", () => {
      raiz.dataset[chave] = campo.value;
      localStorage.setItem(chave, campo.value);
    });
  }
})();

// ── the file editor, on an editable tab ─────────────────────────────
(() => {
  const box = document.querySelector(".file-editor");
  if (!box) return;

  const area = box.querySelector("textarea.raw");
  const rendered = box.querySelector(".rendered");
  const editButton = box.querySelector(".edit-file");
  const saveButton = box.querySelector(".save-file");
  const hint = box.querySelector(".hint");
  const salvo = box.querySelector(".saved");
  let sujo = false;

  const avisar = (texto, ruim) => {
    salvo.textContent = texto;
    salvo.classList.toggle("bad", !!ruim);
    salvo.hidden = false;
    clearTimeout(salvo._t);
    salvo._t = setTimeout(() => { salvo.hidden = true; }, 1800);
  };

  const abrir = () => {
    rendered.hidden = true;
    area.hidden = false;
    editButton.hidden = true;
    saveButton.hidden = false;
    hint.hidden = false;
    area.style.height = Math.max(area.scrollHeight, 400) + "px";
    area.focus();
  };

  const salvar = async () => {
    try {
      const r = await fetch("/api/file/" + box.dataset.tab + "/" + box.dataset.lesson, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: area.value }),
      });
      if (!r.ok) return avisar(${JSON.stringify(v.config.labels.saveError)} + (await r.text()), true);
      sujo = false;
      // Reload so the rendered half shows what was just written: keeping two
      // copies of the same file on screen is how they drift.
      location.reload();
    } catch (e) {
      avisar(${JSON.stringify(v.config.labels.offline)}, true);
    }
  };

  editButton.addEventListener("click", abrir);
  saveButton.addEventListener("click", salvar);
  area.addEventListener("input", () => { sujo = true; });

  addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") {
      ev.preventDefault();
      if (area.hidden) abrir(); else salvar();
    }
  });

  addEventListener("beforeunload", (ev) => {
    if (!sujo) return;
    ev.preventDefault();
    ev.returnValue = "";
  });
})();

// ── the notes editor ────────────────────────────────────────────────
(() => {
  const editor = document.querySelector(".editor");
  if (!editor) return;

  const projeto = editor.dataset.lesson;
  const fields = [...editor.querySelectorAll("textarea[data-section]")];
  const salvo = editor.querySelector(".saved");
  const buttons = [...editor.querySelectorAll(".status-button")];
  let sujo = false;

  const statusAtual = () =>
    buttons.find((b) => b.classList.contains("active"))?.dataset.status ?? ${JSON.stringify(v.firstStatus)};

  const avisar = (texto, ruim) => {
    salvo.textContent = texto;
    salvo.classList.toggle("bad", !!ruim);
    salvo.hidden = false;
    clearTimeout(salvo._t);
    salvo._t = setTimeout(() => { salvo.hidden = true; }, 1800);
  };

  const salvar = async (status) => {
    try {
      const r = await fetch("/api/notes/" + projeto, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: status ?? statusAtual(),
          preamble: editor.querySelector('input[name="preamble"]').value,
          sections: Object.fromEntries(fields.map((c) => [c.dataset.section, c.value])),
        }),
      });
      if (!r.ok) return avisar(${JSON.stringify(v.config.labels.saveError)} + (await r.text()), true);
      sujo = false;
      avisar(${JSON.stringify(v.config.labels.saved)});
    } catch (e) {
      avisar(${JSON.stringify(v.config.labels.offline)}, true);
    }
  };

  for (const b of buttons) {
    b.addEventListener("click", () => {
      for (const outro of buttons) outro.classList.toggle("active", outro === b);
      salvar(b.dataset.status);
    });
  }

  for (const c of fields) {
    c.addEventListener("input", () => { sujo = true; });
    c.addEventListener("blur", () => { if (sujo) salvar(); });
  }
  editor.querySelector(".save-notes").addEventListener("click", () => salvar());

  addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") { ev.preventDefault(); salvar(); }
  });

  // closing the tab with unsaved text is the silliest way to lose a note
  addEventListener("beforeunload", (ev) => {
    if (!sujo) return;
    ev.preventDefault();
    ev.returnValue = "";
  });
})();

// ── copy a code block ───────────────────────────────────────────────
(() => {
  // navigator.clipboard only exists in a secure context. localhost counts,
  // but opening by the machine's IP does not — hence the execCommand plan B.
  const copiar = async (texto) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(texto);
        return true;
      } catch {
        /* cai no plano B */
      }
    }
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const deu = document.execCommand("copy");
    area.remove();
    return deu;
  };

  const responder = (botao, deu, rotuloOriginal) => {
    botao.textContent = deu ? ${JSON.stringify(v.config.labels.copied)} : ${JSON.stringify(
      v.config.labels.failed,
    )};
    botao.classList.toggle("done", deu);
    clearTimeout(botao._volta);
    botao._volta = setTimeout(() => {
      botao.textContent = rotuloOriginal;
      botao.classList.remove("done");
    }, 1400);
  };

  document.addEventListener("click", async (ev) => {
    // a code block inside the text
    const doBloco = ev.target.closest(".copy");
    if (doBloco) {
      const code = doBloco.parentElement.querySelector("pre code");
      if (!code) return;
      // textContent gives back the original source: the highlight tags drop out
      responder(doBloco, await copiar(code.textContent), ${JSON.stringify(v.config.labels.copy)});
      return;
    }

    // file inteiro do Wokwi
    const fileButton = ev.target.closest(".copy-file");
    if (fileButton) {
      const key = fileButton.dataset.file;
      const fonte = fileButton.closest(".card").querySelector('.source[data-file="' + key + '"]');
      if (!fonte) return;
      // the aria-label is the button's stable name; textContent changes while
      // the confirmation is on screen, and restoring from it would leave
      // "Copied" stuck if you clicked twice in a row
      responder(fileButton, await copiar(fonte.textContent), fileButton.getAttribute("aria-label"));
    }
  });
})();

// ── the on-this-page index ──────────────────────────────────────────
(() => {
  const links = [...document.querySelectorAll(".toc .section")];
  if (links.length === 0) return;

  const porId = new Map(links.map((a) => [a.dataset.target, a]));
  const targets = links.map((a) => document.getElementById(a.dataset.target)).filter(Boolean);
  let active = null;

  const marcar = (el) => {
    if (el === active) return;
    active?.classList.remove("here");
    el?.classList.add("here");
    active = el;
    // keeps the entry visible when the index is taller than the screen
    el?.scrollIntoView({ block: "nearest" });
  };

  // The "current" section is the last one whose top has passed the reading
  // line. A plain IntersectionObserver would mark the lower one when two are
  // visible; measuring the position settles it with no special cases.
  const readingLine = 120;
  const recalcular = () => {
    let atual = targets[0];
    for (const el of targets) {
      if (el.getBoundingClientRect().top <= linha) atual = el;
      else break;
    }
    marcar(porId.get(atual?.id));
  };

  addEventListener("scroll", recalcular, { passive: true });
  addEventListener("resize", recalcular, { passive: true });
  recalcular();
})();
</script>
</body>
</html>`;
}

async function buildMenu(v: Viewer, lessons: LessonFile[], active: string): Promise<string> {
  const items = await Promise.all(
    lessons.map(async (p) => {
      // The mark is whatever the status declared. It used to be "feito" and
      // "travei" written here — ids from one repository, invisible to every
      // other one.
      const notes = v.notesEnabled ? await readNotes(v.content, p.folder) : null;
      const mark = escapeHtml(v.statusMark.get(notes?.status ?? "") ?? "");
      const cls = p.folder === active ? ' class="active"' : "";
      const [num, ...rest] = p.folder.split("-");
      return `<a href="/p/${p.folder}"${cls}><span class="num">${num}</span>${escapeHtml(
        p.title || rest.join("-"),
      )} ${mark}</a>`;
    }),
  );

  const refs = (await readReferences(v.content))
    .map(
      (r) =>
        `<a href="/ref/${r.slug}"${active === `ref:${r.slug}` ? ' class="active"' : ""}>${escapeHtml(
          r.title,
        )}</a>`,
    )
    .join("");

  return `<h1>${escapeHtml(v.config.labels.repository)}</h1>
  <a href="/"${active === "" ? ' class="active"' : ""}>${escapeHtml(v.config.labels.home)}</a>
  ${v.menu
    .map(
      (m) =>
        `<a href="${m.url}"${active === m.url ? ' class="active"' : ""}>${escapeHtml(m.title)}</a>`,
    )
    .join("")}
  <h1 style="margin-top:1.8rem">${escapeHtml(v.config.labels.reference)}</h1>${refs}
  <h1 style="margin-top:1.8rem">${escapeHtml(v.config.vocabulary.track)}</h1>${items.join("")}`;
}

async function renderReference(v: Viewer, ref: Reference): Promise<{ body: string; toc: string }> {
  const raw = await Bun.file(ref.path).text();
  const rendered = await marked.parse(raw);
  const { html: withIds, sections } = withAnchors(rendered);

  return { body: withCopyButtons(withIds, v.config.labels), toc: buildPageIndex(v, sections) };
}

/** The current page's index, which becomes the right-hand column. */
function buildPageIndex(v: Viewer, secoes: Section[]): string {
  if (secoes.length === 0) return "";

  const items = secoes
    .map(
      (s) =>
        `<a class="section n${s.level}" href="#${s.id}" data-target="${s.id}">${escapeHtml(s.text)}</a>`,
    )
    .join("");

  return `<aside class="toc"><h2>${escapeHtml(v.config.labels.onThisPage)}</h2>${items}</aside>`;
}

/**
 * The home table.
 *
 * Everything that comes from the notes — the status column, the progress line
 * and the hint that points at the notes tab — is dropped when the repository
 * has no notes tab. Leaving them behind shows a count that can only ever be
 * zero, next to a tab that does not exist.
 */
async function renderHome(v: Viewer, lessons: LessonFile[]): Promise<string> {
  const statuses = v.notesEnabled
    ? await Promise.all(lessons.map((p) => readNotes(v.content, p.folder)))
    : [];

  const rows = lessons.map((p, i) => {
    const cell = v.notesEnabled
      ? `<td>${escapeHtml(v.statusLabel.get(statuses[i]?.status ?? v.firstStatus) ?? "")}</td>`
      : "";
    return `<tr><td><a href="/p/${p.folder}">${escapeHtml(p.title)}</a></td>
        <td>${p.level}</td>${cell}
        <td>${p.parts.length}</td></tr>`;
  });

  const done = v.doneStatus ? statuses.filter((n) => n?.status === v.doneStatus).length : 0;

  const { labels } = v.config;
  const headers = [
    labels.lesson,
    labels.level,
    ...(v.notesEnabled ? [labels.status] : []),
    labels.parts,
  ]
    .map((t) => `<th>${escapeHtml(t)}</th>`)
    .join("");

  const progress = v.notesEnabled
    ? `<p>${fill(escapeHtml(labels.homeProgress), {
        done: `<strong>${done}</strong>`,
        total: `<strong>${lessons.length}</strong>`,
      })}</p>`
    : "";

  const hint = v.notesEnabled
    ? `<p style="margin-top:2rem;color:var(--muted);font-size:14px">
    ${fill(escapeHtml(labels.homeHint), { tab: escapeHtml(labels.myNotes) })}</p>`
    : "";

  return `<h1>${escapeHtml(v.config.title)}</h1>
    ${progress}
    <table><thead><tr>${headers}</tr></thead>
    <tbody>${rows.join("")}</tbody></table>
    ${hint}`;
}

const buildTabs = (v: Viewer, p: LessonFile, tab: string) =>
  v.tabs
    .map(
      ({ id }) =>
        `<a href="/p/${p.folder}?tab=${id}"${id === tab ? ' class="active"' : ""}>${escapeHtml(
          v.tabLabel[id] ?? id,
        )}</a>`,
    )
    .join("");

/** The notes editor: clickable status, and the raw markdown in textareas. */
async function notesEditor(v: Viewer, p: LessonFile): Promise<string> {
  const notes = (await readNotes(v.content, p.folder)) ?? {
    status: v.firstStatus,
    body: "",
  };

  const buttons = v.statusIds
    .map((s) => {
      const active = s === notes.status ? " active" : "";
      return `<button type="button" data-status="${s}" class="status-button${active}"
      >${escapeHtml(v.statusLabel.get(s) ?? s)}</button>`;
    })
    .join("");

  const { preamble, sections } = splitSections(notes.body, v.config.notes.sections);

  const fields = sections
    .map(
      (s) => `<div class="note-field">
      <label for="s-${slugify(s.title)}">${escapeHtml(s.title)}</label>
      <textarea id="s-${slugify(s.title)}" name="body" spellcheck="true"
        data-section="${escapeHtml(s.title)}"
        placeholder="—">${escapeHtml(s.text)}</textarea>
    </div>`,
    )
    .join("");

  return `<div class="editor" data-lesson="${p.folder}">
    <div class="status-row">
      <span class="label">${escapeHtml(v.config.labels.status)}</span>${buttons}
      <span class="saved" hidden>${escapeHtml(v.config.labels.saved)}</span>
    </div>
    ${fields}
    <input type="hidden" name="preamble" value="${escapeHtml(preamble)}">
    <div class="editor-row">
      <button type="button" class="save-notes">${escapeHtml(v.config.labels.save)}</button>
      <span class="hint">${escapeHtml(v.config.labels.notesHint)}</span>
    </div>
  </div>`;
}

/**
 * The editor for a content file: what is rendered, plus the raw markdown
 * behind a button.
 *
 * It is a whole-file textarea and not a field per section, which is what the
 * notes editor does. A notes file has a shape this package defined; an
 * exercises file has whatever shape its author gave it, and splitting that on
 * headings would quietly reorganise someone else's document.
 */
function fileEditor(v: Viewer, p: LessonFile, tab: string, raw: string, rendered: string): string {
  const { labels } = v.config;
  return `<div class="file-editor" data-lesson="${escapeHtml(p.folder)}" data-tab="${escapeHtml(tab)}">
    <div class="editor-row">
      <button type="button" class="edit-file">${escapeHtml(labels.edit)}</button>
      <button type="button" class="save-file" hidden>${escapeHtml(labels.save)}</button>
      <span class="saved" hidden>${escapeHtml(labels.saved)}</span>
      <span class="hint" hidden>${escapeHtml(labels.editHint)}</span>
    </div>
    <div class="rendered">${rendered}</div>
    <textarea class="raw" spellcheck="true" hidden>${escapeHtml(raw)}</textarea>
  </div>`;
}

async function renderLesson(
  v: Viewer,
  p: LessonFile,
  tab: string,
): Promise<{ body: string; toc: string }> {
  if (tab === "notes") {
    const tabs = buildTabs(v, p, tab);
    return {
      body: `<div class="tabs">${tabs}</div>
      <h1>${escapeHtml(v.config.labels.myNotes)} — ${escapeHtml(p.title)}</h1>
      <p class="outside-template">${fill(escapeHtml(v.config.labels.notesIntro), {
        file: `<code>${escapeHtml(v.config.content.mine)}/${escapeHtml(p.folder)}.md</code>`,
        lessons: `<code>${escapeHtml(v.config.content.lessons)}/</code>`,
      })}</p>
      ${await notesEditor(v, p)}`,
      toc: "",
    };
  }

  const file = tab === "exercises" ? v.content.exercisesFile : v.content.lessonFile;
  const raw = await Bun.file(join(p.path, file)).text();
  const rendered = await marked.parse(raw.replace(/^---\n[\s\S]*?\n---\n/, ""));
  const { html: withIds, sections } = withAnchors(rendered);
  const rendedBody = withCopyButtons(withIds, v.config.labels);
  const body = v.editable.has(tab) ? fileEditor(v, p, tab, raw, rendedBody) : rendedBody;

  const tabs = buildTabs(v, p, tab);

  // onLesson BEFORE cards: it is the contract's order, and it is what lets
  // electronics see what the inventory resolved
  const lesson = applyStage(v.plugins, "onLesson", asLesson(v, p));
  const cards = (await collect(v.plugins, "cards", lesson)).join("");

  return {
    body: `<div class="tabs">${tabs}</div>${cards}${body}`,
    toc: buildPageIndex(v, sections),
  };
}

const html = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/** The router, exported so it can be tested without starting a server. */
async function handleRequest(
  v: Viewer,
  req: Request,
  opts: { ip?: string } = {},
): Promise<Response> {
  const url = new URL(req.url);

  try {
    // ── escrita de um arquivo de lição ────────────────────────────
    const fileApi = url.pathname.match(/^\/api\/file\/([^/]+)\/([^/]+)$/);
    if (fileApi) {
      const [, tab, id] = fileApi as unknown as [string, string, string];

      if (req.method !== "POST") {
        return new Response("use POST", { status: 405, headers: { allow: "POST" } });
      }
      if (!(TAB_IDS as readonly string[]).includes(tab)) {
        return new Response(`no tab named ${tab}`, { status: 404 });
      }
      // Same reason as the notes endpoint: the server binds wide so the
      // browser reaches it across a VM boundary, and writing a file to disk
      // from the network is not something reading is.
      if (opts.ip && !LOOPBACK.has(opts.ip)) {
        return new Response("writes are allowed from this machine only", { status: 403 });
      }
      // Not "is this a tab", but "did the config open this tab for writing".
      // A tab that never asked is as closed as one that does not exist.
      const file = v.editable.get(tab);
      if (!file) {
        return new Response(`the \`${tab}\` tab is not editable in this repository`, {
          status: 403,
        });
      }

      const lesson = (await readLessons(v.content)).find((p) => p.folder === id);
      if (!lesson) return new Response("lesson not found", { status: 404 });

      let payload: { text?: unknown };
      try {
        payload = await req.json();
      } catch {
        return new Response("body is not JSON", { status: 400 });
      }
      // An absent `text` is refused rather than treated as "": a save that
      // silently emptied the file would be the worst possible default here.
      if (typeof payload.text !== "string") {
        return new Response("body needs a `text` string", { status: 400 });
      }

      await Bun.write(join(lesson.path, file), payload.text);
      return Response.json({ ok: true });
    }

    // ── escrita das notes ─────────────────────────────────────────
    const notesApi = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (notesApi) {
      if (req.method !== "POST") {
        return new Response("use POST", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      // The server listens on 0.0.0.0 so the VM host can reach it. Reading
      // from anywhere is harmless; WRITING a file to disk from the network
      // is not.
      if (opts.ip && !LOOPBACK.has(opts.ip)) {
        return new Response("writes are allowed from this machine only", { status: 403 });
      }

      const id = notesApi[1]!;
      const exists = (await readLessons(v.content)).some((p) => p.folder === id);
      if (!exists) return new Response("lesson not found", { status: 404 });

      let payload: {
        status?: string;
        body?: string;
        preamble?: string;
        sections?: Record<string, string>;
      };
      try {
        payload = await req.json();
      } catch {
        return new Response("body is not JSON", { status: 400 });
      }

      const status = payload.status ?? v.firstStatus;
      if (!v.statusIds.includes(status)) {
        return new Response(`invalid status: ${status}`, { status: 400 });
      }

      const before = await readNotes(v.content, id);

      // The editor sends section by section, and the headings are rebuilt here
      // — which is why you cannot delete one by accident. A payload that omits
      // a section is merged against what is on disk rather than trusted as the
      // whole note: a partial request must not silently drop what it did not
      // mention.
      const onDisk = splitSections(before?.body ?? "", v.config.notes.sections);
      const finalBody = payload.sections
        ? joinSections(
            payload.preamble ?? onDisk.preamble,
            onDisk.sections
              .map((s) => ({ title: s.title, text: payload.sections?.[s.title] ?? s.text }))
              .concat(
                Object.entries(payload.sections)
                  .filter(([title]) => !onDisk.sections.some((s) => s.title === title))
                  .map(([title, text]) => ({ title, text: String(text) })),
              ),
          )
        : (payload.body ?? before?.body ?? "");

      await writeNotes(
        v.content,
        id,
        {
          status: status as Notes["status"],
          // stamps the date the first time it leaves "not started"
          date: before?.date ?? (status !== v.firstStatus ? today() : undefined),
        },
        finalBody,
      );

      return Response.json({ ok: true, status });
    }

    if (url.pathname.startsWith("/assets/")) {
      const asset = v.assets.get(url.pathname.slice("/assets/".length));
      if (!asset) return new Response("unknown asset", { status: 404 });
      return new Response(Bun.file(asset.path), {
        headers: {
          "content-type": asset.type,
          "cache-control": "max-age=3600",
        },
      });
    }

    const lessons = await readLessons(v.content);

    if (url.pathname === "/") {
      return html(
        renderPage(
          v,
          v.config.title,
          await buildMenu(v, lessons, ""),
          await renderHome(v, lessons),
        ),
      );
    }

    for (const handleRequest of v.routes) {
      const matched = url.pathname.match(handleRequest.pattern);
      if (!matched) continue;
      const body = await handleRequest.handle(req, matched);
      // the plugin returns the middle only; the shell builds the page
      const inner = typeof body === "string" ? body : await body.text();
      return html(renderPage(v, v.config.title, await buildMenu(v, lessons, url.pathname), inner));
    }

    const refMatch = url.pathname.match(/^\/ref\/([^/]+)$/);
    if (refMatch) {
      // looks it up in the list instead of building a path from the URL:
      // `..` is not a case to handle, it is a slug that is not on the list
      const ref = (await readReferences(v.content)).find((r) => r.slug === refMatch[1]);
      if (!ref) return new Response("reference not found", { status: 404 });

      const { body, toc } = await renderReference(v, ref);
      return html(
        renderPage(v, ref.title, await buildMenu(v, lessons, `ref:${ref.slug}`), body, toc),
      );
    }

    const matched = url.pathname.match(/^\/p\/([^/]+)$/);
    if (matched) {
      const p = lessons.find((x) => x.folder === matched[1]);
      if (!p) return new Response("lesson not found", { status: 404 });

      // Against the *declared* tabs, not the shell's set: a tab this
      // repository dropped must not stay reachable by typing the URL.
      const tab = url.searchParams.get("tab") ?? v.tabs[0]?.id ?? "lesson";
      if (!v.tabs.some((t) => t.id === tab)) return new Response("unknown tab", { status: 404 });

      const { body, toc } = await renderLesson(v, p, tab);
      return html(renderPage(v, p.title, await buildMenu(v, lessons, p.folder), body, toc));
    }

    return new Response("not found", { status: 404 });
  } catch (e) {
    return new Response(`failed to render:\n\n${e}`, { status: 500 });
  }
}
