/**
 * Loads the plugins a config declares.
 *
 * The shell does not know any plugin by name; it knows how to import a script
 * that exports a factory. That is what keeps `electronics` out of the shell's
 * imports — swap the config and the same shell serves a marketing repository.
 */
import { join } from "node:path";
import { type Config, type Plugin, type Registry, register } from "./plugin.ts";

/** A plugin script exports one factory; the default export or a named one. */
type Factory = () => Plugin;

async function loadOne(script: string, root: string): Promise<Plugin> {
  const mod = (await import(script.startsWith(".") ? join(root, script) : script)) as Record<
    string,
    unknown
  >;

  const factory =
    (mod.default as Factory | undefined) ??
    (Object.values(mod).find((v) => typeof v === "function") as Factory | undefined);

  if (!factory) {
    throw new Error(`${script} exports no plugin factory`);
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
