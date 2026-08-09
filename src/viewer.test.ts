import { describe, expect, test } from "bun:test";
import { contentFrom, readNotes, writeNotes } from "./content.ts";
import { DEFAULT_LABELS, normalizeConfig, readConfig } from "./plugin.ts";
import { createViewer, TABS, withAnchors, withCopyButtons } from "./viewer.ts";

const REPO = new URL("../test/repo", import.meta.url).pathname;
const CONFIG = await readConfig(`${REPO}/bancada.config.json`);
const CONTENT = contentFrom(CONFIG, REPO);
const VIEWER = await createViewer(CONFIG, REPO);

const request = (path: string) => VIEWER.handleRequest(new Request(`http://localhost${path}`));
const bodyOf = async (path: string) => (await request(path)).text();

describe("createViewer", () => {
  test("takes its root as an argument, so a package need not guess", async () => {
    expect(VIEWER.content.lessons).toBe(`${REPO}/lessons`);
    expect((await bodyOf("/")).includes("The first lesson")).toBe(true);
  });

  test("two viewers coexist without sharing state", async () => {
    const other = await createViewer(
      normalizeConfig({
        ...CONFIG,
        labels: { ...CONFIG.labels, repository: "OTHER_REPO" },
      }),
      REPO,
    );
    expect(await bodyOf("/")).not.toContain("OTHER_REPO");
    expect(await (await other.handleRequest(new Request("http://localhost/"))).text()).toContain(
      "OTHER_REPO",
    );
  });

  test("importing the module reads no file — the factory does", async () => {
    const src = await Bun.file(new URL("./viewer.ts", import.meta.url).pathname).text();
    const beforeFactory = src.slice(0, src.indexOf("export async function createViewer"));
    expect(beforeFactory).not.toContain("await readConfig()");
    expect(beforeFactory).not.toContain("await loadPlugins(");
  });
});

describe("routes", () => {
  test("the home page answers 200", async () => {
    expect((await request("/")).status).toBe(200);
  });

  test("a lesson that exists answers 200", async () => {
    expect((await request("/p/01-first")).status).toBe(200);
  });

  test("a lesson that does not exist answers 404", async () => {
    expect((await request("/p/99-nothing")).status).toBe(404);
  });

  test("an unknown path answers 404", async () => {
    expect((await request("/anything")).status).toBe(404);
  });

  test("an unknown tab answers 404 instead of falling back to the lesson", async () => {
    expect((await request("/p/01-first?tab=../../etc/passwd")).status).toBe(404);
  });

  test.each([...TABS])("the %s tab answers 200", async (tab) => {
    expect((await request(`/p/01-first?tab=${tab}`)).status).toBe(200);
  });

  test("answers HTML with a charset — the accents depend on it", async () => {
    const res = await request("/");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-type")).toContain("utf-8");
  });

  test("does not serve a file from outside the reference folder", async () => {
    for (const bad of ["/ref/../package.json", "/ref/..%2fpackage.json", "/ref/../../etc/passwd"]) {
      expect((await request(bad)).status, bad).not.toBe(200);
    }
  });

  test("an unknown asset path answers 404", async () => {
    expect((await request("/assets/anything.js")).status).toBe(404);
  });
});

/**
 * The shell ships English and a repository overrides what it needs. A label
 * born hardcoded is invisible until someone runs it in another language, so
 * these compare what the page shows against what the config says.
 */
describe("every UI string comes from the config", () => {
  test("the home table's headers are the configured labels", async () => {
    const headers = [...(await bodyOf("/")).matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual([
      CONFIG.labels.lesson,
      CONFIG.labels.level,
      CONFIG.labels.status,
      CONFIG.labels.parts,
    ]);
  });

  test("a lesson's tabs are the configured labels", async () => {
    const html = await bodyOf("/p/01-first");
    const tabs = [...html.matchAll(/tab=[a-z]+"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(tabs).toEqual([CONFIG.labels.lesson, CONFIG.labels.exercises, CONFIG.labels.myNotes]);
  });

  test("the header selects use the config's label, visible and accessible", async () => {
    const html = await bodyOf("/");
    expect(html).toContain(`>${CONFIG.labels.theme}</label>`);
    expect(html).toMatch(new RegExp(`id="theme"[^>]*aria-label="${CONFIG.labels.themeAria}"`));
    expect(html).toMatch(new RegExp(`id="font"[^>]*aria-label="${CONFIG.labels.fontAria}"`));
  });

  test("a translated label reaches the page, and the default does not", async () => {
    const translated = await createViewer(
      normalizeConfig({ ...CONFIG, labels: { ...CONFIG.labels, onThisPage: "Nesta página" } }),
      REPO,
    );
    const html = await (
      await translated.handleRequest(new Request("http://localhost/ref/safety"))
    ).text();
    expect(html).toContain("Nesta página");
    expect(html).not.toContain(`<h2>${DEFAULT_LABELS.onThisPage}</h2>`);
  });

  test("no page title is a string literal in the source", async () => {
    // the home page really did carry `renderPage("Eletrônica", …)`, and the
    // repository that found it was called Eletrônica — so the assertion that
    // compared values passed. A title that is a literal is hardcoded by
    // definition, so this asks the source instead.
    const src = await Bun.file(new URL("./viewer.ts", import.meta.url).pathname).text();
    expect([...src.matchAll(/renderPage\(\s*(["'`])/g)].map((m) => m[0])).toEqual([]);
  });

  test("a lesson and a reference carry their own title, not the repository's", async () => {
    for (const path of ["/p/01-first", "/ref/safety"]) {
      const title = (await bodyOf(path)).match(/<title>([^<]*)<\/title>/)?.[1];
      expect(title, path).toBeTruthy();
      expect(title, path).not.toBe(CONFIG.title);
    }
  });

  test("the document language comes from the config", async () => {
    expect(await bodyOf("/")).toContain(`<html lang="${CONFIG.lang}">`);
  });

  test("the note statuses and their labels both come from the config", async () => {
    const html = await bodyOf("/p/01-first?tab=notes");
    for (const s of CONFIG.notes.statuses) {
      expect(html, s.id).toContain(`data-status="${s.id}"`);
      expect(html, s.label).toContain(s.label);
    }
  });

  test("one textarea per configured section, each one labelled", async () => {
    const html = await bodyOf("/p/01-first?tab=notes");
    const fields = [...html.matchAll(/<textarea[^>]*data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(CONFIG.notes.sections);
  });
});

describe("the inline scripts are valid JS", () => {
  // A `\n` written loose inside the server's template literal becomes a real
  // newline in the emitted JS: unterminated string, SyntaxError, and the whole
  // <script> dies with it — including what was already working.
  const scriptsOf = (html: string) =>
    [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

  const pages = ["/", "/p/01-first", "/p/01-first?tab=notes", "/ref/safety"];

  test.each(pages)("the scripts on %s compile", async (path) => {
    const scripts = scriptsOf(await bodyOf(path));
    expect(scripts.length).toBeGreaterThan(0);
    for (const [i, code] of scripts.entries()) {
      expect(() => new Function(code), `${path} script #${i}`).not.toThrow();
    }
  });
});

describe("markdown, anchors and the on-this-page index", () => {
  test("renders the markdown instead of dumping the raw text", async () => {
    const html = await bodyOf("/p/01-first");
    expect(html).toContain("<h1");
    expect(html).not.toContain("\n# ");
  });

  test("does not leak the frontmatter onto the page", async () => {
    expect(await bodyOf("/p/01-first")).not.toContain("concepts:");
  });

  test("every index link points at an id that exists on the page", async () => {
    const html = await bodyOf("/p/01-first");
    const targets = [...html.matchAll(/<a class="[^"]*section[^"]*" href="#([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(targets.length).toBeGreaterThan(1);
    for (const t of targets) expect(html, `anchor #${t}`).toContain(`id="${t}"`);
  });

  test("ids survive accents and punctuation", async () => {
    const ids = [...(await bodyOf("/p/02-second")).matchAll(/<h[23] id="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9-]+$/);
  });

  test("ids are unique — a duplicate anchor would always land on the first", () => {
    const { sections } = withAnchors("<h2>Same</h2><h2>Same</h2><h3>Same</h3>");
    const ids = sections.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("each tab gets the index of ITS sections", async () => {
    const sections = (h: string) =>
      [...h.matchAll(/<a class="[^"]*section[^"]*" href="#([^"]+)"/g)].map((m) => m[1]);
    expect(sections(await bodyOf("/p/01-first?tab=lesson"))).not.toEqual(
      sections(await bodyOf("/p/01-first?tab=exercises")),
    );
  });

  test("the index does not appear on the home page", async () => {
    expect(await bodyOf("/")).not.toContain('class="toc"');
  });
});

describe("withCopyButtons", () => {
  const labels = { copy: "Copy", copyCode: "Copy code" };

  test("wraps the block and adds the button", () => {
    const r = withCopyButtons("<pre><code>hi</code></pre>", labels);
    expect(r).toContain('class="code-block"');
    expect(r).toContain('class="copy"');
    expect(r).toContain("<pre><code>hi</code></pre>");
  });

  test("one button per block, no more and no fewer", () => {
    const r = withCopyButtons("<pre><code>a</code></pre><p>x</p><pre><code>b</code></pre>", labels);
    expect((r.match(/class="copy"/g) ?? []).length).toBe(2);
  });

  test("leaves inline code alone — that is a function name, not a program", () => {
    const html = "<p>use <code>pinMode()</code> here</p>";
    expect(withCopyButtons(html, labels)).toBe(html);
  });

  test("takes its label from the caller, never from a constant", () => {
    const r = withCopyButtons("<pre><code>x</code></pre>", { copy: "Copiar", copyCode: "Código" });
    expect(r).toContain(">Copiar</button>");
    expect(r).toContain('aria-label="Código"');
  });

  test("the button is a real button, with a type and an accessible name", () => {
    const r = withCopyButtons("<pre><code>x</code></pre>", labels);
    expect(r).toContain('type="button"');
    expect(r).toMatch(/aria-label="[^"]+"/);
  });

  test("every code block on a page gets its button", async () => {
    const html = await bodyOf("/p/01-first");
    const blocks = (html.match(/<pre>/g) ?? []).length;
    expect(blocks).toBeGreaterThan(0);
    expect((html.match(/class="copy"/g) ?? []).length).toBe(blocks);
  });
});

describe("editing the notes over HTTP", () => {
  const ID = "01-first";
  const save = (payload: unknown, ip?: string) =>
    VIEWER.handleRequest(
      new Request(`http://localhost/api/notes/${ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      ip ? { ip } : undefined,
    );

  const restore = async () => {
    const original = await readNotes(CONTENT, ID);
    return async () => {
      if (original) await writeNotes(CONTENT, ID, original, original.body);
    };
  };

  test("saving section by section rebuilds the headings", async () => {
    const undo = await restore();
    try {
      const r = await save({
        status: "in-progress",
        preamble: "# My notes",
        sections: { "What went wrong": "I wired it backwards" },
      });
      expect(r.status).toBe(200);

      const body = (await readNotes(CONTENT, ID))!.body;
      for (const s of CONFIG.notes.sections) expect(body, s).toContain(`## ${s}`);
      expect(body).toContain("I wired it backwards");
    } finally {
      await undo();
    }
  });

  test("emptying a field does not delete its heading", async () => {
    const undo = await restore();
    try {
      await save({
        status: "in-progress",
        sections: Object.fromEntries(CONFIG.notes.sections.map((s) => [s, ""])),
      });
      const body = (await readNotes(CONTENT, ID))!.body;
      for (const s of CONFIG.notes.sections) expect(body, s).toContain(`## ${s}`);
    } finally {
      await undo();
    }
  });

  test("refuses a status outside the configured vocabulary", async () => {
    expect((await save({ status: "finished", body: "x" })).status).toBe(400);
  });

  test("refuses a lesson that does not exist — no writing a stray file", async () => {
    const r = await VIEWER.handleRequest(
      new Request("http://localhost/api/notes/99-nothing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done", body: "x" }),
      }),
    );
    expect(r.status).toBe(404);
    expect(await Bun.file(`${REPO}/mine/99-nothing.md`).exists()).toBe(false);
  });

  test("refuses a write coming from off this machine", async () => {
    expect((await save({ status: "done", body: "x" }, "10.0.0.9")).status).toBe(403);
  });

  test("accepts a write from loopback", async () => {
    const undo = await restore();
    try {
      expect((await save({ status: "done", body: "x" }, "127.0.0.1")).status).toBe(200);
      expect((await save({ status: "done", body: "x" }, "::1")).status).toBe(200);
    } finally {
      await undo();
    }
  });

  test("a GET on the write endpoint does not write", async () => {
    const r = await VIEWER.handleRequest(new Request(`http://localhost/api/notes/${ID}`));
    expect(r.status).toBe(405);
  });

  test("a body that is not JSON is refused, not swallowed", async () => {
    const r = await VIEWER.handleRequest(
      new Request(`http://localhost/api/notes/${ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("escaping", () => {
  test("the page closes the tags it opens", async () => {
    const html = await bodyOf("/p/01-first");
    expect(html.split("<body").length).toBe(2);
    expect(html).toContain("</html>");
  });

  test("markdown cannot inject a second body", async () => {
    for (const path of ["/", "/p/01-first", "/ref/safety"]) {
      expect((await bodyOf(path)).split("<body").length, path).toBe(2);
    }
  });
});
