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
  notStarted: string;
  inProgress: string;
  done: string;
  stuck: string;
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
  /** Prose. `{}` placeholders are filled by `fill()`. */
  notesIntro: string;
  notesHint: string;
  homeProgress: string;
  homeHint: string;
  /** Shown by the notes editor when a save does not land. */
  saveError: string;
  offline: string;
}

export interface Config {
  title: string;
  /** Goes into `<html lang>`; screen readers pick pronunciation from it. */
  lang: string;
  content: { lessons: string; reference: string; mine: string };
  vocabulary: { lesson: string; track: string };
  notes: { sections: string[] };
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
  theme: "Theme",
  font: "Font",
  notStarted: "not started",
  inProgress: "in progress",
  done: "done",
  stuck: "stuck",
  level: "Level",
  parts: "Parts",
  themeAria: "Colour theme",
  fontAria: "Reading font",
  copyCode: "Copy code",
  notesIntro:
    "This file is yours and lives in {file}, outside {lessons} — nothing generated " +
    "writes over it, and the repository can be shared without it.",
  notesHint: "markdown in each field · ⌘/Ctrl+S saves · saves on its own when you leave a field",
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
  content: { lessons: "lessons", reference: "reference", mine: "mine" },
  vocabulary: { lesson: "lesson", track: "Track" },
  notes: { sections: ["What went wrong", "What I did not understand"] },
  theme: { default: "paper", font: "serif" },
};

export function normalizeConfig(raw: Partial<Config>): Config {
  if (!raw.title) {
    throw new Error("config has no `title` — it is the name shown in the header");
  }

  return {
    title: raw.title,
    lang: raw.lang ?? "en",
    content: { ...DEFAULTS.content, ...raw.content },
    vocabulary: { ...DEFAULTS.vocabulary, ...raw.vocabulary },
    notes: { ...DEFAULTS.notes, ...raw.notes },
    theme: { ...DEFAULTS.theme, ...raw.theme },
    labels: { ...DEFAULT_LABELS, ...raw.labels },
    plugins: (raw.plugins ?? []).map((p) => ({ ...p, config: p.config ?? {} })),
  };
}

/**
 * Reads a repository's config. The path defaults to the working directory:
 * the package must not assume where it was installed.
 */
export async function readConfig(
  path = join(process.cwd(), "bancada.config.json"),
): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`config not found at ${path}`);
  return normalizeConfig(await file.json());
}
