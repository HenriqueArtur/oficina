import { readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { Config } from "./plugin.ts";

/**
 * Where a repository keeps its content, resolved once.
 *
 * Every reader below takes this instead of reaching for a constant. A package
 * cannot know it was installed beside `projetos/`, and the repository that
 * declares `content.lessons` is the only one that does.
 */
export interface Content {
  root: string;
  lessons: string;
  reference: string;
  mine: string;
  lessonFile: string;
  exercisesFile: string;
  referenceOrder: string[];
  frontmatter: Config["frontmatter"];
}

export function contentFrom(config: Config, root: string = process.cwd()): Content {
  return {
    root,
    lessons: join(root, config.content.lessons),
    reference: join(root, config.content.reference),
    mine: join(root, config.content.mine),
    lessonFile: config.content.lessonFile,
    exercisesFile: config.content.exercisesFile,
    referenceOrder: config.content.referenceOrder,
    frontmatter: config.frontmatter,
  };
}

// ─────────────────────────── lessons ───────────────────────────

/** One line of a lesson's parts list. */
export interface PartUse {
  id: string;
  qty: number;
}

/**
 * A lesson as it sits on disk.
 *
 * The field names here are English; the frontmatter keys they come from are
 * whatever the repository writes in its own language. `content.frontmatter`
 * is the only place the two meet, so nothing downstream knows the author's.
 */
export interface LessonFile {
  /** Folder name — also the id in URLs. */
  folder: string;
  /** Absolute path to the folder. */
  path: string;
  id: string;
  title: string;
  level: number;
  requires: string[];
  parts: PartUse[];
  pins: Record<string, string>;
  concepts: string[];
  body: string;
}

export interface Notes {
  status: string;
  /** ISO date, stamped the first time the status leaves "not started". */
  date?: string;
  body: string;
}

/**
 * Everything of yours lives in `meu/`, outside `projetos/`. The split is so
 * the repository can be shared as a template without carrying your notes and
 * your progress along — and so nothing generated ever steps on them.
 */
export const notesPath = (c: Content, lessonId: string) => join(c.mine, `${lessonId}.md`);

export async function readLessons(c: Content): Promise<LessonFile[]> {
  const front = c.frontmatter;
  const entries = await readdir(c.lessons, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const lessons: LessonFile[] = [];
  for (const folder of folders) {
    const path = join(c.lessons, folder);
    const file = Bun.file(join(path, c.lessonFile));
    if (!(await file.exists())) continue;

    const { data, content } = matter(await file.text());
    const declared = (data[front.parts] ?? []) as { id: string; qtd?: number; qty?: number }[];

    lessons.push({
      folder,
      path,
      id: data.id ?? "",
      title: data[front.title] ?? "",
      level: data[front.level] ?? 0,
      requires: data[front.requires] ?? [],
      parts: declared.map((d) => ({ id: d.id, qty: d.qty ?? d.qtd ?? 1 })),
      pins: data[front.pins] ?? {},
      concepts: data[front.concepts] ?? [],
      body: content,
    });
  }
  return lessons;
}

/**
 * YAML parses an unquoted `2026-08-08` into a Date, so the frontmatter comes
 * back as an object where the type promises a string. Writing that back
 * produced `data: Fri Aug 07 2026 21:00:00 GMT-0300` — and a day earlier than
 * the file said, because the local zone is behind UTC. Normalising on the way
 * in keeps the format the file already had.
 */
function asIsoDay(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

export async function readNotes(c: Content, lessonId: string): Promise<Notes | null> {
  const file = Bun.file(notesPath(c, lessonId));
  if (!(await file.exists())) return null;

  const { data, content } = matter(await file.text());
  return {
    status: data.status ?? "",
    date: asIsoDay(data.data),
    body: content,
  };
}

export interface Section {
  title: string;
  text: string;
}

/**
 * Splits a note body into a preamble plus one section per `##`.
 *
 * The template's sections always come out, even when the file lacks them —
 * otherwise a field would vanish from the screen. And a hand-written section
 * that is not in the template comes along at the end, because deleting what
 * you wrote would be far worse.
 */
/**
 * `template` is the sections every note has — `config.notes.sections`. Each
 * becomes one textarea in the editor: a single field would let you delete your
 * own headings by accident, and every note would end up a different shape from
 * the last.
 */
export function splitSections(
  body: string,
  template: string[] = [],
): {
  preamble: string;
  sections: Section[];
} {
  const lines = body.split("\n");
  const preamble: string[] = [];
  const found = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = [];
      found.set(heading[1]!, current);
      continue;
    }
    (current ?? preamble).push(line);
  }

  const sections: Section[] = template.map((title) => ({
    title,
    text: (found.get(title) ?? []).join("\n").trim(),
  }));

  for (const [title, sectionLines] of found) {
    if (template.includes(title)) continue;
    sections.push({ title, text: sectionLines.join("\n").trim() });
  }

  return { preamble: preamble.join("\n").trim(), sections };
}

/** The inverse of `splitSections`. A heading always comes out, even if empty. */
export function joinSections(preamble: string, sections: Section[]): string {
  const parts = preamble.trim() ? [preamble.trim()] : [];
  for (const s of sections) {
    parts.push(`## ${s.title}\n${s.text.trim() ? `\n${s.text.trim()}` : ""}`);
  }
  return `${parts.join("\n\n")}\n`;
}

/** Writes frontmatter + body. Only the viewer calls this; nothing generated does. */
export async function writeNotes(
  c: Content,
  lessonId: string,
  meta: Partial<Notes>,
  body: string,
): Promise<void> {
  const lines = [
    "---",
    `status: ${meta.status ?? ""}`,
    `data:${meta.date ? ` ${meta.date}` : ""}`,
    "---",
    "",
  ];
  const text = `${lines.join("\n")}\n${body.replace(/^\n+/, "").trimEnd()}\n`;
  await Bun.write(notesPath(c, lessonId), text);
}

// ───────────────────────── referência ─────────────────────────

export interface Reference {
  slug: string;
  title: string;
  path: string;
}

export async function readReferences(c: Content): Promise<Reference[]> {
  const files = (await readdir(c.reference)).filter((f) => f.endsWith(".md"));

  const refs = await Promise.all(
    files.map(async (file) => {
      const path = join(c.reference, file);
      const text = await Bun.file(path).text();
      const slug = file.replace(/\.md$/, "");
      return {
        slug,
        path,
        title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug,
      };
    }),
  );

  // Reading order, not alphabetical, and a file that is not on the list lands
  // at the end so it never falls out of the menu by omission.
  const position = (s: string) => {
    const i = c.referenceOrder.indexOf(s);
    return i === -1 ? c.referenceOrder.length : i;
  };
  return refs.sort((a, b) => position(a.slug) - position(b.slug) || a.slug.localeCompare(b.slug));
}

// ─────────────────────────── formatting ───────────────────────────

export const paint = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
