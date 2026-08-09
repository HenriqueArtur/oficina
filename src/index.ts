/**
 * bancada — a local-first study workbench.
 *
 * This entry point is the contract a plugin codes against, plus the loader and
 * the theme catalogue. Import types from here, never from a deep path: the
 * file layout is not the API.
 */

export { loadPlugins } from "./loader.ts";
export {
  type Asset,
  applyStage,
  type Config,
  collect,
  DEFAULT_LABELS,
  type DeclaredPlugin,
  fill,
  type Labels,
  type Lesson,
  type MenuItem,
  normalizeConfig,
  type Plugin,
  type Registry,
  type Route,
  readConfig,
  register,
  STAGES,
  type Stage,
} from "./plugin.ts";

export {
  COLOR_KEYS,
  type ColorKey,
  DEFAULT_FONT,
  DEFAULT_THEME,
  FONTS,
  type Font,
  THEMES,
  type Theme,
  themeCss,
} from "./themes.ts";
