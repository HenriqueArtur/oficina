import { describe, expect, test } from "bun:test";
import { loadPlugins } from "./loader.ts";
import { normalizeConfig } from "./plugin.ts";

describe("loadPlugins", () => {
  test("a config with no plugins yields an empty registry, not an error", async () => {
    const reg = await loadPlugins(normalizeConfig({ title: "x" }));
    expect(reg.plugins).toEqual([]);
  });

  test("refuses a declaration with no script — there is nothing to import", async () => {
    const config = normalizeConfig({ title: "x", plugins: [{ name: "a" } as never] });
    await expect(loadPlugins(config)).rejects.toThrow(/script/);
  });

  test("refuses a script that does not exist, instead of loading nothing", async () => {
    const config = normalizeConfig({
      title: "x",
      plugins: [{ name: "a", script: "./no-such-plugin.ts", config: {} }],
    });
    await expect(loadPlugins(config)).rejects.toThrow();
  });
});
