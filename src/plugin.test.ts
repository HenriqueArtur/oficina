import { describe, expect, test } from "bun:test";
import { applyStage, collect, normalizeConfig, type Plugin, register, STAGES } from "./plugin.ts";

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
