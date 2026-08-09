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

/**
 * The loader used to take "the first exported function" when there was no
 * default. That is a guess, and it held only while a plugin exported exactly
 * one function. `@bancada/inventory` 0.1.1 exported its readers too, and the
 * loader picked `checkRunningLow` as the factory — failing deep inside the
 * plugin, with a message that named neither the plugin nor the real cause.
 */
describe("the loader does not guess which export is the plugin", () => {
  const load = async (mod: Record<string, unknown>) => {
    const path = `/tmp/bancada-probe-${Math.trunc(performance.now() * 1000)}.ts`;
    const body = Object.entries(mod)
      .map(([k, v]) => `export ${k === "default" ? "default" : `const ${k} =`} ${v};`)
      .join("\n");
    await Bun.write(path, body);
    try {
      return await loadPlugins(
        normalizeConfig({ title: "x", plugins: [{ name: "probe", script: path, config: {} }] }),
      );
    } finally {
      await Bun.file(path)
        .delete()
        .catch(() => {});
    }
  };

  test("takes the default export", async () => {
    const reg = await load({ default: `() => ({ name: "probe" })` });
    expect(reg.plugins[0]!.name).toBe("probe");
  });

  test("takes a named export called `plugin` when there is no default", async () => {
    const reg = await load({ plugin: `() => ({ name: "probe" })` });
    expect(reg.plugins[0]!.name).toBe("probe");
  });

  test("refuses a module with helpers and no declared factory", async () => {
    // this is the shape that broke: several functions, none of them named
    await expect(
      load({ checkRunningLow: `() => []`, readInventory: `() => new Map()` }),
    ).rejects.toThrow(/default|plugin/);
  });

  test("the refusal names what it did find, so the fix is obvious", async () => {
    await expect(load({ checkRunningLow: `() => []` })).rejects.toThrow(/checkRunningLow/);
  });
});
