/**
 * Loads the plugins a config declares.
 *
 * The shell does not know any plugin by name; it knows how to import a script
 * that exports a factory. That is what keeps `electronics` out of the shell's
 * imports — swap the config and the same shell serves a marketing repository.
 */
import { join } from "node:path";
import { type Config, type Plugin, type Registry, register } from "./plugin.ts";

/** A plugin script exports one factory: the default export, or `plugin`. */
type Factory = () => Plugin;

/**
 * This used to take "the first exported function" when there was no default.
 * That is a guess, and it held only while a plugin exported exactly one
 * function — the moment `@bancada/inventory` also exported its readers, the
 * loader called `checkRunningLow` as the factory and failed deep inside the
 * plugin, naming neither the plugin nor the cause.
 *
 * A module that says which export is the plugin is a contract. Picking one is
 * a coin toss that lands right for a while.
 */
async function loadOne(script: string, root: string): Promise<Plugin> {
  const mod = (await import(script.startsWith(".") ? join(root, script) : script)) as Record<
    string,
    unknown
  >;

  const factory = (mod.default ?? mod.plugin) as Factory | undefined;

  if (typeof factory !== "function") {
    const functions = Object.entries(mod)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    const found = functions.length
      ? `it exports ${functions.join(", ")}`
      : "it exports no function";
    throw new Error(
      `${script} declares no plugin factory: ${found}. ` +
        "A plugin script exports its factory as `default`, or as a named export called `plugin`.",
    );
  }
  return factory();
}

export async function loadPlugins(config: Config, root: string = process.cwd()): Promise<Registry> {
  const plugins: Plugin[] = [];

  for (const declared of config.plugins) {
    if (!declared.script) {
      throw new Error(`plugin '${declared.name}' has no script to load`);
    }

    const plugin = await loadOne(declared.script, root);

    if (plugin.name !== declared.name) {
      // Otherwise the config would key settings by one name and the plugin
      // would answer to another, and nobody would notice.
      throw new Error(
        `config declares '${declared.name}' but ${declared.script} exports '${plugin.name}'`,
      );
    }

    // `root` lets a plugin resolve paths without knowing where it was installed
    await plugin.configure?.({ root, ...declared.config });
    plugins.push(plugin);
  }

  return register(plugins);
}
