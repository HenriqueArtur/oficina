/**
 * The contract between the shell and its plugins.
 *
 * The shell knows how to render markdown, keep notes and build a menu. It does
 * not know what a resistor is. Anything that belongs to a subject — a parts
 * inventory, a circuit drawing, a 3D viewer — comes in through here.
 *
 * A plugin implements only the stages it cares about and ignores the rest.
 */
import { join } from "node:path";

/**
 * The stages of building a page, in the order they happen.
 *
 * The order is the contract: `onLesson` enriches the data before anyone draws
 * anything, and `transformBody` only runs once the markdown is already HTML. A
 * plugin declared after another one sees what the previous one produced.
 */
export const STAGES = [
  "configure", // receives its own config; fail early here
  "onLesson", // enrich the lesson with whatever the subject needs
  "cards", // cards alongside the lesson
  "transformBody", // rewrite the rendered HTML
  "styles", // extra CSS
  "scripts", // extra client-side JS
  "assets", // static files to serve
  "routes", // routes of its own
  "menuItems", // entries in the sidebar
  "validate", // findings for the repository check
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages that collect from everyone; the rest pipe a value through. */
const COLLECTING = new Set<Stage>([
  "cards",
  "styles",
  "scripts",
  "assets",
  "routes",
  "menuItems",
  "validate",
]);

// biome-ignore lint/suspicious/noExplicitAny: each stage's type belongs to the subject
type Anything = any;

/**
 * What the shell knows about a lesson, and what every plugin receives.
 *
 * The index signature is the extension point: a plugin enriches the lesson in
 * `onLesson` by attaching its own key, and a plugin declared later reads it.
 * That is how one plugin uses another's work without importing it.
 */
export interface Lesson {
  /** Folder name, and the id used in URLs. */
  id: string;
  title: string;
  level: number;
  requires: string[];
  /** Absolute path to the lesson folder. */
  path: string;
  /** Everything the frontmatter declared, untouched. */
  front: Record<string, Anything>;
  body: string;
  [attached: string]: Anything;
}

export interface Asset {
  name: string;
  path: string;
  type: string;
}

export interface Route {
  pattern: RegExp;
  handle: (req: Request, match: RegExpMatchArray) => Anything;
}

export interface MenuItem {
  title: string;
  url: string;
}

export interface Plugin {
  name: string;
  configure?: (config: Record<string, unknown>) => void | Promise<void>;
  onLesson?: (lesson: Anything) => Anything;
  cards?: (lesson: Anything) => string[] | Promise<string[]>;
  transformBody?: (html: string, ctx?: Anything) => string;
  styles?: () => string[];
  scripts?: () => string[];
  assets?: () => Asset[];
  routes?: () => Route[];
  menuItems?: () => MenuItem[];
  validate?: (lesson: Anything) => Anything[];
}

export interface Registry {
  plugins: Plugin[];
}

export function register(plugins: Plugin[]): Registry {
  const seen = new Set<string>();
  for (const p of plugins) {
    if (!p.name) throw new Error("plugin without a name — the name keys its config");
    if (seen.has(p.name)) {
      throw new Error(`two plugins named '${p.name}'; names must be unique`);
    }
    seen.add(p.name);
  }
  return { plugins };
}

/**
 * Run a piping stage: the value travels down the line, each plugin receiving
 * what the previous one returned. Synchronous — these only reshape data.
 */
export function applyStage(reg: Registry, stage: Stage, input: Anything): Anything {
  if (COLLECTING.has(stage)) {
    throw new Error(`'${stage}' collects; use collect() — it may need to read files`);
  }

  let value = input;
  for (const p of reg.plugins) {
    const f = p[stage] as ((v: Anything) => Anything) | undefined;
    if (f) value = f.call(p, value);
  }
  return value;
}

/**
 * Run a collecting stage and concatenate what everyone contributed.
 *
 * Always async, even for stages that happen to be synchronous today: `cards`
 * reads files from disk, and a caller that has to know which stages are async
 * would get it wrong the first time a plugin starts reading something.
 */
export async function collect(reg: Registry, stage: Stage, input: Anything): Promise<Anything[]> {
  if (!COLLECTING.has(stage)) {
    throw new Error(`'${stage}' pipes a value; use applyStage()`);
  }

  const all: Anything[] = [];
  for (const p of reg.plugins) {
    const f = p[stage] as ((i: Anything) => Anything[] | Promise<Anything[]>) | undefined;
    if (f) all.push(...((await f.call(p, input)) ?? []));
  }
  return all;
}

// ─────────────────────────── config ───────────────────────────

export interface DeclaredPlugin {
  name: string;
  script?: string;
  config: Record<string, unknown>;
}

/**
 * Every string the shell puts on screen. English by default; a repository in
 * another language overrides what it needs. A public shell cannot hardcode
 * one language, and a half-translated page is worse than an English one.
 */
export interface Labels {
  lesson: string;
  exercises: string;
  myNotes: string;
  onThisPage: string;
  copy: string;
  copied: string;
  failed: string;
  home: string;
  reference: string;
  repository: string;
  status: string;
  save: string;
  saved: string;
  theme: string;
  font: string;
  /** Column headers on the home table. */
  level: string;
  parts: string;
  /**
   * Accessible names for the two header selects. Separate keys because the
   * visible label is one word and the accessible name has to say what it
   * selects — and because keeping them apart is what exposed a rename that
   * had translated one and not the other.
   */
  themeAria: string;
  fontAria: string;
  copyCode: string;
  /** Opens the editor on an editable tab. */
  edit: string;
  /** Prose. `{}` placeholders are filled by `fill()`. */
  notesIntro: string;
  notesHint: string;
  editHint: string;
  homeProgress: string;
  homeHint: string;
  /** Shown by the notes editor when a save does not land. */
  saveError: string;
  offline: string;
}

/** The tabs a lesson page can have. The order in the config is the order on screen. */
export const TAB_IDS = ["lesson", "exercises", "notes"] as const;

export type TabId = (typeof TAB_IDS)[number];

export interface TabConfig {
  id: TabId;
  /**
   * Opens the shell's editor on this tab's file. Ignored for `notes`, which
   * has an editor of its own.
   *
   * Editing a lesson file writes inside the lessons folder — the part of the
   * repository that is meant to be shareable as a template. A repository that
   * turns this on is saying that file belongs to its reader, and nothing
   * generated should overwrite it again.
   */
  editable?: boolean;
}

export interface StatusConfig {
  id: string;
  label: string;
  /** The finished state: what the home progress counts. At most one. */
  done?: boolean;
  /** Shown beside the lesson in the sidebar — "✓", "!", whatever fits. */
  mark?: string;
}

export interface Config {
  title: string;
  /** Goes into `<html lang>`; screen readers pick pronunciation from it. */
  lang: string;
  content: {
    lessons: string;
    reference: string;
    mine: string;
    /** File names inside a lesson folder; content, so the repository names them. */
    lessonFile: string;
    exercisesFile: string;
    /**
     * Reference slugs in reading order. What is not on the list lands at the
     * end, so a new file never falls out of the menu by omission.
     */
    referenceOrder: string[];
  };
  /**
   * Frontmatter key → field. A repository writes its frontmatter in its own
   * language; the shell reads the same six things whatever they are called.
   */
  frontmatter: {
    title: string;
    level: string;
    requires: string;
    parts: string;
    pins: string;
    concepts: string;
  };
  vocabulary: { lesson: string; track: string };
  /** @see Config.notes.statuses */
  notes: {
    sections: string[];
    /**
     * The statuses a note may carry, in the order the editor shows them.
     *
     * `id` is DATA — it is written into the notes file — and `label` is what
     * the screen says. Keeping them apart is what lets a repository translate
     * the display without rewriting files that belong to its reader.
     *
     * `done` says which status the home progress counts, and `mark` is what
     * the sidebar shows beside a lesson in that state. Both used to be
     * hardcoded Portuguese ids in this package — every repository that did not
     * happen to name a status `feito` got a progress count stuck at zero, and
     * nothing said why.
     */
    statuses: StatusConfig[];
  };
  /**
   * Which tabs a lesson page has, in order, and which of them write.
   *
   * A repository whose exercises are the place its reader writes does not
   * want a notes tab; one that is read-only wants neither. `editable` opens
   * the shell's editor on that tab's file — see the write endpoint in the
   * viewer, which refuses any tab that did not ask for it.
   */
  tabs: TabConfig[];
  theme: { default: string; font: string };
  labels: Labels;
  plugins: DeclaredPlugin[];
}

export const DEFAULT_LABELS: Labels = {
  lesson: "Lesson",
  exercises: "Exercises",
  myNotes: "My notes",
  onThisPage: "On this page",
  copy: "Copy",
  copied: "Copied",
  failed: "Failed",
  home: "Home",
  reference: "Reference",
  repository: "Repository",
  status: "Status",
  save: "Save",
  saved: "saved",
  edit: "Edit",
  theme: "Theme",
  font: "Font",
  level: "Level",
  parts: "Parts",
  themeAria: "Colour theme",
  fontAria: "Reading font",
  copyCode: "Copy code",
  notesIntro:
    "This file is yours and lives in {file}, outside {lessons} — nothing generated " +
    "writes over it, and the repository can be shared without it.",
  notesHint: "markdown in each field · ⌘/Ctrl+S saves · saves on its own when you leave a field",
  editHint: "the whole file, as markdown · ⌘/Ctrl+S saves",
  homeProgress: "{done} of {total} done.",
  homeHint: "The status comes from each lesson's notes file — edit it in {tab} and reload.",
  saveError: "error: ",
  offline: "no connection to the server",
};

/**
 * Fills `{name}` placeholders in a label.
 *
 * A missing key is left as-is rather than becoming `undefined`: a visible
 * `{tab}` on screen tells you which label is wrong, and the page still renders.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

const DEFAULTS = {
  content: {
    lessons: "lessons",
    reference: "reference",
    mine: "mine",
    lessonFile: "lesson.md",
    exercisesFile: "exercises.md",
    referenceOrder: [],
  },
  frontmatter: {
    title: "title",
    level: "level",
    requires: "requires",
    parts: "parts",
    pins: "pins",
    concepts: "concepts",
  },
  vocabulary: { lesson: "lesson", track: "Track" },
  notes: {
    sections: ["What went wrong", "What I did not understand"],
    statuses: [
      { id: "not-started", label: "not started" },
      { id: "in-progress", label: "in progress" },
      { id: "done", label: "done", done: true, mark: "✓" },
      { id: "stuck", label: "stuck", mark: "!" },
    ],
  },
  tabs: TAB_IDS.map((id) => ({ id })),
  theme: { default: "paper", font: "serif" },
};

/**
 * A tab list has to be checked at config time, not at render time: a typo
 * would drop a tab from the page, and a missing tab looks exactly like a tab
 * that was never wanted.
 */
function normalizeTabs(raw: TabConfig[] | undefined): TabConfig[] {
  if (raw === undefined) return DEFAULTS.tabs.map((t) => ({ ...t }));
  if (raw.length === 0) {
    throw new Error("config has an empty `tabs` — a lesson page needs at least one");
  }

  const seen = new Set<string>();
  for (const tab of raw) {
    if (!(TAB_IDS as readonly string[]).includes(tab.id)) {
      throw new Error(`unknown tab \`${tab.id}\` — the shell has ${TAB_IDS.join(", ")}`);
    }
    if (seen.has(tab.id)) throw new Error(`tab \`${tab.id}\` is declared twice`);
    seen.add(tab.id);
  }
  return raw.map((t) => ({ ...t }));
}

function normalizeStatuses(raw: StatusConfig[]): StatusConfig[] {
  const done = raw.filter((s) => s.done);
  if (done.length > 1) {
    throw new Error(
      `${done.length} statuses are marked \`done\` (${done
        .map((s) => s.id)
        .join(", ")}) — the progress count would not know which one to count`,
    );
  }
  return raw;
}

/**
 * A config as it comes out of the file: every level optional, because a
 * repository overrides one key and inherits the rest. `Partial<Config>` only
 * reaches the top level, which forced every caller to cast.
 */
export type RawConfig = {
  [K in keyof Config]?: Config[K] extends Array<unknown>
    ? Config[K]
    : Config[K] extends object
      ? Partial<Config[K]>
      : Config[K];
};

export function normalizeConfig(raw: RawConfig): Config {
  if (!raw.title) {
    throw new Error("config has no `title` — it is the name shown in the header");
  }

  return {
    title: raw.title,
    lang: raw.lang ?? "en",
    content: { ...DEFAULTS.content, ...raw.content },
    frontmatter: { ...DEFAULTS.frontmatter, ...raw.frontmatter },
    vocabulary: { ...DEFAULTS.vocabulary, ...raw.vocabulary },
    notes: (() => {
      const notes = { ...DEFAULTS.notes, ...raw.notes };
      return { ...notes, statuses: normalizeStatuses(notes.statuses) };
    })(),
    tabs: normalizeTabs(raw.tabs),
    theme: { ...DEFAULTS.theme, ...raw.theme },
    labels: { ...DEFAULT_LABELS, ...raw.labels },
    plugins: (raw.plugins ?? []).map((p) => ({ ...p, config: p.config ?? {} })),
  };
}

/**
 * Reads a repository's config. The path defaults to the working directory:
 * a package must not assume where it was installed.
 */
export async function readConfig(
  path = join(process.cwd(), "bancada.config.json"),
): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`config not found at ${path}`);
  return normalizeConfig(await file.json());
}
