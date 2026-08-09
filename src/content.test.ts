import { describe, expect, test } from "bun:test";
import {
  contentFrom,
  joinSections,
  notesPath,
  readLessons,
  readNotes,
  readReferences,
  splitSections,
  writeNotes,
} from "./content.ts";
import { readConfig } from "./plugin.ts";

const REPO = new URL("../test/repo", import.meta.url).pathname;
const CONFIG = await readConfig(`${REPO}/bancada.config.json`);
const CONTENT = contentFrom(CONFIG, REPO);
const SECTIONS = CONFIG.notes.sections;

describe("contentFrom", () => {
  test("resolves the folders the config names, under the root it is given", () => {
    expect(CONTENT.lessons).toBe(`${REPO}/lessons`);
    expect(CONTENT.reference).toBe(`${REPO}/reference`);
    expect(CONTENT.mine).toBe(`${REPO}/mine`);
  });

  test("defaults the root to the working directory, not to where it was installed", () => {
    // a package cannot know it sits beside the repository that uses it
    expect(contentFrom(CONFIG).lessons).toBe(`${process.cwd()}/lessons`);
  });
});

const lessons = await readLessons(CONTENT);

describe("readLessons", () => {
  test("finds the lessons in the configured folder", () => {
    expect(lessons.map((l) => l.folder)).toEqual(["01-first", "02-second"]);
  });

  test("comes ordered by folder name, which is the track order", () => {
    const folders = lessons.map((l) => l.folder);
    expect(folders).toEqual([...folders].sort());
  });

  test("reads the file the config names, not a fixed one", () => {
    expect(CONTENT.lessonFile).toBe("lesson.md");
    expect(lessons[0]!.title).toBe("The first lesson");
  });

  test("separates the frontmatter from the body", () => {
    for (const l of lessons) {
      expect(l.body, l.folder).not.toContain("title:");
      expect(l.body.trim(), l.folder).toBeTruthy();
    }
  });

  test("maps the frontmatter keys the config declares onto the English fields", async () => {
    // this fixture writes English keys; a repository writing another language
    // gets the same fields out, which is the whole point of the mapping
    const renamed = contentFrom(
      { ...CONFIG, frontmatter: { ...CONFIG.frontmatter, title: "nao-existe" } },
      REPO,
    );
    expect((await readLessons(renamed))[0]!.title).toBe("");
    expect(lessons[0]!.title).toBe("The first lesson");
  });

  test("a folder with no lesson file is skipped, not a crash", async () => {
    const empty = contentFrom(
      { ...CONFIG, content: { ...CONFIG.content, lessonFile: "x.md" } },
      REPO,
    );
    expect(await readLessons(empty)).toEqual([]);
  });
});

describe("readNotes and writeNotes", () => {
  test("reads the status out of the notes file", async () => {
    expect((await readNotes(CONTENT, "02-second"))?.status).toBe("done");
  });

  test("returns null when there is no notes file", async () => {
    expect(await readNotes(CONTENT, "99-nothing")).toBeNull();
  });

  test("notes live in the configured folder, outside the lessons", () => {
    expect(notesPath(CONTENT, "01-first")).toBe(`${REPO}/mine/01-first.md`);
    expect(notesPath(CONTENT, "01-first")).not.toContain("/lessons/");
  });

  test("writes and reads back", async () => {
    const id = "__round-trip";
    try {
      await writeNotes(CONTENT, id, { status: "done", date: "2026-01-02" }, "body here");
      const back = await readNotes(CONTENT, id);
      expect(back?.status).toBe("done");
      expect(back?.date).toBe("2026-01-02");
      expect(back?.body).toContain("body here");
    } finally {
      await Bun.file(notesPath(CONTENT, id))
        .delete()
        .catch(() => {});
    }
  });

  test("a date survives a round trip as the day the file wrote", async () => {
    // YAML reads an unquoted 2026-01-02 as a Date, so writing it back produced
    // `data: Fri Jan 01 2026 21:00:00 GMT-0300` — the wrong format AND a day
    // early, because the local zone is behind UTC. It corrupted a real file.
    const id = "__date-round-trip";
    try {
      await writeNotes(CONTENT, id, { status: "done", date: "2026-01-02" }, "x");
      const once = await readNotes(CONTENT, id);
      await writeNotes(CONTENT, id, once!, once!.body);
      const twice = await readNotes(CONTENT, id);

      expect(typeof once!.date).toBe("string");
      expect(twice!.date).toBe("2026-01-02");
      expect(await Bun.file(notesPath(CONTENT, id)).text()).toContain("data: 2026-01-02");
    } finally {
      await Bun.file(notesPath(CONTENT, id))
        .delete()
        .catch(() => {});
    }
  });

  test("a note with no date reads back without inventing one", async () => {
    expect((await readNotes(CONTENT, "01-first"))?.date).toBeUndefined();
  });

  test("keeps the body when only the status changes", async () => {
    const id = "__keeps-body";
    try {
      await writeNotes(CONTENT, id, { status: "in-progress" }, "must survive");
      const before = await readNotes(CONTENT, id);
      await writeNotes(CONTENT, id, { ...before!, status: "done" }, before!.body);
      const after = await readNotes(CONTENT, id);
      expect(after?.body).toContain("must survive");
      expect(after?.status).toBe("done");
    } finally {
      await Bun.file(notesPath(CONTENT, id))
        .delete()
        .catch(() => {});
    }
  });
});

describe("splitSections and joinSections", () => {
  const TEMPLATE = `# My notes

<!-- a template comment -->

## What went wrong

I wired it backwards.

## What I did not understand
`;

  test("splits one section per level-2 heading", () => {
    expect(splitSections(TEMPLATE, SECTIONS).sections.map((s) => s.title)).toEqual(SECTIONS);
  });

  test("the preamble stays outside the sections", () => {
    const { preamble } = splitSections(TEMPLATE, SECTIONS);
    expect(preamble).toContain("# My notes");
    expect(preamble).not.toContain("I wired it backwards");
  });

  test("a template section missing from the file comes out empty", () => {
    const { sections } = splitSections("## What went wrong\n\nx\n", SECTIONS);
    expect(sections.map((s) => s.title)).toEqual(SECTIONS);
    expect(sections[1]!.text).toBe("");
  });

  test("a hand-written section outside the template does not vanish", () => {
    const { sections } = splitSections(`${TEMPLATE}\n## Loose ideas\n\nkeep me\n`, SECTIONS);
    expect(sections.find((s) => s.title === "Loose ideas")?.text).toBe("keep me");
  });

  test("with no template at all, only what the file has comes out", () => {
    expect(splitSections("## Only\n\nx\n").sections.map((s) => s.title)).toEqual(["Only"]);
  });

  test("a round trip preserves the content", () => {
    const { preamble, sections } = splitSections(TEMPLATE, SECTIONS);
    const again = splitSections(joinSections(preamble, sections), SECTIONS);
    expect(again.sections.map((s) => s.text)).toEqual(sections.map((s) => s.text));
  });

  test("joinSections never leaves a section without its heading", () => {
    const text = joinSections("# t", [
      { title: "A", text: "x" },
      { title: "B", text: "" },
    ]);
    expect(text).toContain("## A");
    expect(text).toContain("## B");
  });
});

describe("readReferences", () => {
  test("finds the markdown in the configured folder", async () => {
    const refs = await readReferences(CONTENT);
    expect(refs.map((r) => r.slug)).toEqual(["safety", "basics"]);
  });

  test("takes the title from the first h1, not from the file name", async () => {
    const refs = await readReferences(CONTENT);
    expect(refs.find((r) => r.slug === "safety")?.title).toBe("Safety");
  });

  test("follows the configured reading order, not the alphabet", async () => {
    // alphabetically `basics` comes first; the config says safety leads
    expect((await readReferences(CONTENT))[0]!.slug).toBe("safety");
  });

  test("a file the order does not name lands at the end, never dropped", async () => {
    const unordered = contentFrom(
      { ...CONFIG, content: { ...CONFIG.content, referenceOrder: ["basics"] } },
      REPO,
    );
    expect((await readReferences(unordered)).map((r) => r.slug)).toEqual(["basics", "safety"]);
  });
});

describe("paint", () => {
  test("wraps and closes, so a colour never bleeds into the next line", async () => {
    const { paint } = await import("./content.ts");
    for (const [name, fn] of Object.entries(paint)) {
      expect(fn("x"), name).toEndWith("\x1b[0m");
      expect(fn("x"), name).toContain("x");
    }
  });
});
