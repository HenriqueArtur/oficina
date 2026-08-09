/**
 * bancada — a local-first study workbench.
 *
 * This entry point is the contract a plugin codes against, plus the loader and
 * the theme catalogue. Import types from here, never from a deep path: the
 * file layout is not the API.
 */

export {
  type Content,
  contentFrom,
  joinSections,
  type LessonFile,
  type Notes,
  notesPath,
  type PartUse,
  paint,
  type Reference,
  readLessons,
  readNotes,
  readReferences,
  type Section,
  splitSections,
  writeNotes,
} from "./content.ts";
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
  type RawConfig,
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
export {
  createViewer,
  slugify,
  TABS,
  type Tab,
  type Viewer,
  withAnchors,
  withCopyButtons,
} from "./viewer.ts";
