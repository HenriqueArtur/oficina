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
  type DeclaredPlugin,
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
  CHAVES_DE_COR as COLOR_KEYS,
  type ChaveDeCor as ColorKey,
  cssDosTemas as themeCss,
  FONTE_PADRAO as DEFAULT_FONT,
  FONTES as FONTS,
  type Fonte as Font,
  TEMA_PADRAO as DEFAULT_THEME,
  TEMAS as THEMES,
  type Tema as Theme,
} from "./themes.ts";
