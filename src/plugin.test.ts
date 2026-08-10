import { describe, expect, test } from "bun:test";
import {
  applyStage,
  collect,
  DEFAULT_LABELS,
  fill,
  normalizeConfig,
  type Plugin,
  register,
  STAGES,
} from "./plugin.ts";

const empty = (over: Partial<Plugin> = {}): Plugin => ({
  name: "test",
  ...over,
});

describe("pipeline stages", () => {
  test("are the ones a page needs to be built", () => {
    expect(STAGES).toEqual([
      "configure",
      "onLesson",
      "cards",
      "transformBody",
      "styles",
      "scripts",
      "assets",
      "routes",
      "menuItems",
      "validate",
    ]);
  });

  test("no stage is listed twice", () => {
    expect(STAGES.length as number).toBe(new Set(STAGES).size);
  });
});

describe("register", () => {
  test("takes a plugin that implements only what it wants", () => {
    const reg = register([empty(), empty({ name: "other", cards: () => ["<div/>"] })]);
    expect(reg.plugins).toHaveLength(2);
  });

  test("refuses two plugins with the same name", () => {
    expect(() => register([empty(), empty()])).toThrow(/test/);
  });

  test("refuses a plugin without a name", () => {
    expect(() => register([{ name: "" } as Plugin])).toThrow();
  });

  test("keeps the declared order — a later plugin sees the earlier one's work", () => {
    const reg = register([empty({ name: "a" }), empty({ name: "b" })]);
    expect(reg.plugins.map((p) => p.name)).toEqual(["a", "b"]);
  });
});

describe("collect — collecting stages", () => {
  test("cards gathers from everyone, in order", async () => {
    const reg = register([
      empty({ name: "a", cards: () => ["<a/>"] }),
      empty({ name: "b", cards: () => ["<b1/>", "<b2/>"] }),
    ]);
    expect(await collect(reg, "cards", {})).toEqual(["<a/>", "<b1/>", "<b2/>"]);
  });

  test("a plugin that skips the stage does not get in the way", async () => {
    const reg = register([empty({ name: "a" }), empty({ name: "b", cards: () => ["<b/>"] })]);
    expect(await collect(reg, "cards", {})).toEqual(["<b/>"]);
  });

  test("no plugins at all yields an empty list rather than blowing up", async () => {
    expect(await collect(register([]), "cards", {})).toEqual([]);
  });
});

describe("the two natures cannot be confused", () => {
  test("applyStage refuses a collecting stage", () => {
    expect(() => applyStage(register([]), "cards", {})).toThrow(/collect/);
  });

  test("collect refuses a piping stage", async () => {
    await expect(collect(register([]), "transformBody", "x")).rejects.toThrow(/applyStage/);
  });
});

describe("applyStage — piping stages", () => {
  test("transformBody chains: one plugin's output is the next one's input", () => {
    const reg = register([
      empty({ name: "a", transformBody: (html) => `${html}+a` }),
      empty({ name: "b", transformBody: (html) => `${html}+b` }),
    ]);
    expect(applyStage(reg, "transformBody", "base")).toBe("base+a+b");
  });

  test("whoever skips it passes the value through untouched", () => {
    const reg = register([
      empty({ name: "a" }),
      empty({ name: "b", transformBody: (h) => `${h}!` }),
    ]);
    expect(applyStage(reg, "transformBody", "x")).toBe("x!");
  });
});

describe("config", () => {
  test("fills a minimal config with the defaults", () => {
    const c = normalizeConfig({ title: "Marketing" });
    expect(c.title).toBe("Marketing");
    expect(c.content.lessons).toBe("lessons");
    expect(c.content.mine).toBe("mine");
    expect(c.plugins).toEqual([]);
  });

  test("what the file says wins over the default", () => {
    const c = normalizeConfig({
      title: "x",
      content: { lessons: "projetos" } as never,
    });
    expect(c.content.lessons).toBe("projetos");
    expect(c.content.reference).toBe("reference");
  });

  test("refuses a config without a title — it is the name in the header", () => {
    expect(() => normalizeConfig({} as never)).toThrow(/title/);
  });

  test("each plugin's config sits next to its declaration", () => {
    const c = normalizeConfig({
      title: "x",
      plugins: [{ name: "components", config: { inventory: "inv.yml" } }],
    });
    expect(c.plugins[0]!.config).toEqual({ inventory: "inv.yml" });
  });

  test("a plugin with no config gets an empty object, not undefined", () => {
    const c = normalizeConfig({
      title: "x",
      plugins: [{ name: "a" } as never],
    });
    expect(c.plugins[0]!.config).toEqual({});
  });

  test("note sections are configurable", () => {
    const c = normalizeConfig({
      title: "x",
      notes: { sections: ["Ideas", "Doubts"] },
    });
    expect(c.notes.sections).toEqual(["Ideas", "Doubts"]);
  });

  test("vocabulary is configurable — not every subject says 'lesson'", () => {
    const c = normalizeConfig({
      title: "x",
      vocabulary: { lesson: "class", track: "Course" },
    });
    expect(c.vocabulary.lesson).toBe("class");
  });
});

/**
 * Which tabs a lesson page has is the repository's call. A study whose
 * exercises are the place you write does not want a notes tab, and one that
 * only reads does not want either.
 */
describe("tabs", () => {
  test("default to all three, in reading order", () => {
    const c = normalizeConfig({ title: "x" });
    expect(c.tabs.map((t) => t.id)).toEqual(["lesson", "exercises", "notes"]);
  });

  test("nothing is editable by default — writing is opt-in", () => {
    const c = normalizeConfig({ title: "x" });
    expect(c.tabs.every((t) => !t.editable)).toBe(true);
  });

  test("a repository can drop a tab", () => {
    const c = normalizeConfig({
      title: "x",
      tabs: [{ id: "lesson" }, { id: "exercises", editable: true }],
    });
    expect(c.tabs.map((t) => t.id)).toEqual(["lesson", "exercises"]);
    expect(c.tabs[1]!.editable).toBe(true);
  });

  test("refuses a tab id the shell does not have — a typo would silently hide a tab", () => {
    expect(() => normalizeConfig({ title: "x", tabs: [{ id: "exercicios" }] as never })).toThrow(
      /exercicios/,
    );
  });

  test("refuses an empty list — a lesson page with no tab shows nothing", () => {
    expect(() => normalizeConfig({ title: "x", tabs: [] })).toThrow(/tabs/);
  });

  test("refuses the same tab twice", () => {
    expect(() =>
      normalizeConfig({ title: "x", tabs: [{ id: "lesson" }, { id: "lesson" }] }),
    ).toThrow(/lesson/);
  });
});

/**
 * `done` and `mark` used to be the hardcoded strings "feito" and "travei" in
 * the shell — Portuguese ids from the repository this package was extracted
 * from. Every other repository got an empty progress count and no marks, and
 * nothing said why.
 */
describe("status flags", () => {
  test("a status can declare itself the finished one", () => {
    const c = normalizeConfig({
      title: "x",
      notes: {
        statuses: [
          { id: "a", label: "a" },
          { id: "b", label: "b", done: true },
        ],
      },
    });
    expect(c.notes.statuses[1]!.done).toBe(true);
  });

  test("a status can carry a mark for the sidebar", () => {
    const c = normalizeConfig({
      title: "x",
      notes: { statuses: [{ id: "stuck", label: "stuck", mark: "!" }] },
    });
    expect(c.notes.statuses[0]!.mark).toBe("!");
  });

  test("refuses two finished statuses — the progress count would be ambiguous", () => {
    expect(() =>
      normalizeConfig({
        title: "x",
        notes: {
          statuses: [
            { id: "a", label: "a", done: true },
            { id: "b", label: "b", done: true },
          ],
        },
      }),
    ).toThrow(/done/);
  });
});

describe("labels", () => {
  test("default to English — a public shell cannot pick one language", () => {
    const c = normalizeConfig({ title: "x" });
    expect(c.labels.myNotes).toBe("My notes");
    expect(c.labels.onThisPage).toBe("On this page");
    expect(c.labels.copy).toBe("Copy");
  });

  test("a repository overrides only what it needs", () => {
    const c = normalizeConfig({
      title: "x",
      labels: { myNotes: "Minhas notas" } as never,
    });
    expect(c.labels.myNotes).toBe("Minhas notas");
    expect(c.labels.copy).toBe("Copy"); // o resto segue no padrão
  });

  test("every label has a non-empty default — a missing one renders as blank", () => {
    const c = normalizeConfig({ title: "x" });
    for (const [key, value] of Object.entries(c.labels)) {
      expect(value, key).toBeTruthy();
    }
  });
});

describe("fill", () => {
  test("replaces a placeholder with its value", () => {
    expect(fill("{a} of {b}", { a: 3, b: 16 })).toBe("3 of 16");
  });

  test("the same placeholder twice is replaced in both", () => {
    expect(fill("{x}/{x}", { x: "a" })).toBe("a/a");
  });

  test("a key nobody passed stays visible instead of becoming undefined", () => {
    // `undefined` on screen does not say which label is wrong; `{tab}` does
    expect(fill("see it in {tab}", {})).toBe("see it in {tab}");
  });

  test("text with no placeholder passes through untouched", () => {
    expect(fill("nothing here", { a: 1 })).toBe("nothing here");
  });

  test("a spare key is ignored in silence", () => {
    expect(fill("{a}", { a: 1, spare: 2 })).toBe("1");
  });

  test("zero is a value, not an absence", () => {
    expect(fill("{n} done", { n: 0 })).toBe("0 done");
  });
});

describe("the document language", () => {
  test("defaults to English, the language of the package", () => {
    expect(normalizeConfig({ title: "x" }).lang).toBe("en");
  });

  test("a repository picks its own", () => {
    expect(normalizeConfig({ title: "x", lang: "pt-BR" }).lang).toBe("pt-BR");
  });

  test("every label has a default, even when the config translates only some", () => {
    const c = normalizeConfig({ title: "x", labels: { save: "Salvar" } as never });
    expect(c.labels.save).toBe("Salvar");
    expect(c.labels.copy).toBe(DEFAULT_LABELS.copy);
    for (const k of Object.keys(DEFAULT_LABELS)) {
      expect(c.labels[k as keyof typeof DEFAULT_LABELS], k).toBeTruthy();
    }
  });

  test("the prose labels carry the placeholders the viewer fills", () => {
    expect(DEFAULT_LABELS.notesIntro).toContain("{file}");
    expect(DEFAULT_LABELS.homeProgress).toContain("{done}");
    expect(DEFAULT_LABELS.homeProgress).toContain("{total}");
  });
});
