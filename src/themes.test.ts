import { describe, expect, test } from "bun:test";
import { COLOR_KEYS, type ColorKey, DEFAULT_THEME, FONTS, THEMES, themeCss } from "./themes.ts";

describe("the theme catalogue", () => {
  test("ships at least twelve", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(12);
  });

  test("the default names a theme that exists", () => {
    expect(DEFAULT_THEME).toBe("paper");
    expect(THEMES.find((t) => t.id === DEFAULT_THEME)).toBeTruthy();
  });

  test("every theme declares ALL the colour keys", () => {
    for (const theme of THEMES) {
      for (const key of COLOR_KEYS) {
        // a missing one lets the previous theme's colour leak through in
        // silence, which is worse than an ugly theme
        expect(theme.colors[key], `${theme.id} → ${key}`).toBeTruthy();
      }
    }
  });

  test("and no key beyond them, so no colour goes dead", () => {
    for (const theme of THEMES) {
      for (const key of Object.keys(theme.colors)) {
        expect([...COLOR_KEYS] as string[], `${theme.id} → ${key}`).toContain(key);
      }
    }
  });

  test("every colour is a six-digit hex", () => {
    for (const theme of THEMES) {
      for (const [key, value] of Object.entries(theme.colors) as [ColorKey, string][]) {
        expect(value, `${theme.id} → ${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("ids are kebab-case, so they become CSS selectors without escaping", () => {
    for (const t of THEMES) expect(t.id, t.id).toMatch(/^[a-z0-9-]+$/);
  });

  test("no id repeats", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("every theme says whether it is light or dark", () => {
    for (const t of THEMES) expect(["light", "dark"], t.id).toContain(t.mode);
  });

  test("there are enough of each to pick from", () => {
    expect(THEMES.filter((t) => t.mode === "light").length).toBeGreaterThanOrEqual(4);
    expect(THEMES.filter((t) => t.mode === "dark").length).toBeGreaterThanOrEqual(6);
  });

  test("the well-known palettes are present", () => {
    const ids = THEMES.map((t) => t.id);
    for (const expected of ["dracula", "nord", "gruvbox-dark", "tokyo-night", "one-dark"]) {
      expect(ids, expected).toContain(expected);
    }
    expect(ids.some((i) => i.startsWith("catppuccin"))).toBe(true);
    expect(ids.some((i) => i.startsWith("solarized"))).toBe(true);
  });
});

describe("minimum contrast", () => {
  // text on background has to be readable; a beautiful illegible theme is no use
  const luminance = (hex: string) => {
    const channel = (i: number) => {
      const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };

  test("text on background clears 4.5:1 (WCAG AA) in every theme", () => {
    // 4.5 is the floor for body text. Not raised to 7 (AAA) because the
    // well-known palettes do not aim for AAA — official Rosé Pine Dawn comes
    // out at 6.66 — and a faithful palette beats a colour we invented.
    for (const t of THEMES) {
      expect(ratio(t.colors.text, t.colors.bg), t.id).toBeGreaterThan(4.5);
    }
  });

  test("the default theme, the most used one, clears 7:1 (AAA)", () => {
    const fallback = THEMES.find((t) => t.id === DEFAULT_THEME)!;
    expect(ratio(fallback.colors.text, fallback.colors.bg)).toBeGreaterThan(7);
  });

  test("muted text still clears 4.5:1", () => {
    for (const t of THEMES) {
      expect(ratio(t.colors.muted, t.colors.bg), t.id).toBeGreaterThan(4.5);
    }
  });

  test("the accent separates from the background", () => {
    for (const t of THEMES) {
      expect(ratio(t.colors.accent, t.colors.bg), t.id).toBeGreaterThan(3);
    }
  });

  test("a code comment is readable on the code background", () => {
    for (const t of THEMES) {
      expect(ratio(t.colors["code-comment"], t.colors["code-bg"]), t.id).toBeGreaterThan(3);
    }
  });
});

describe("fonts", () => {
  test("there is a serif, the one preferred for reading", () => {
    expect(FONTS.map((f) => f.id)).toContain("serif");
  });

  test("at least three to choose from", () => {
    expect(FONTS.length).toBeGreaterThanOrEqual(3);
  });

  test("every stack ends in a generic family, so it never falls through", () => {
    for (const f of FONTS) {
      expect(f.stack, f.id).toMatch(/(serif|sans-serif|monospace)\s*$/);
    }
  });

  test("ids are kebab-case and do not repeat", () => {
    const ids = FONTS.map((f) => f.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("themeCss", () => {
  const css = themeCss();

  test("emits one block per theme, addressed by data-theme", () => {
    for (const t of THEMES) {
      expect(css, t.id).toContain(`[data-theme="${t.id}"]`);
    }
  });

  test("the default also applies with no data-theme at all", () => {
    expect(css).toContain(":root");
  });

  test("declares every variable with the right prefix", () => {
    for (const key of COLOR_KEYS) {
      expect(css, key).toContain(`--${key}:`);
    }
  });

  test("emits the font stacks", () => {
    for (const f of FONTS) {
      expect(css, f.id).toContain(`[data-font="${f.id}"]`);
    }
  });
});
