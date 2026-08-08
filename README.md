# bancada

A local-first study workbench. Markdown lessons on disk, your notes beside
them, and plugins for whatever you are actually learning.

It is meant for the kind of study that has *things* in it — electronics, 3D
printing, woodworking — where a lesson is not only text but also a parts list,
a diagram, a model. The shell knows nothing about any of that. Plugins do.

## Status

v0, in development. The plugin contract and the theme catalogue are here; the
viewer that renders the pages lands next.

## Why

A repository of markdown files is already a good place to study: it is
versioned, greppable, and yours. What it lacks is a way to read it that knows
your subject — to show a parts list next to the lesson that uses it, to draw
the circuit the text describes, to say "you cannot build this one, you are two
resistors short".

Every tool that does that is welded to one subject. bancada is the half that
is not.

## What the shell does

- renders markdown lessons in a reading order you declare
- keeps your notes and progress **outside** the lesson folders, so the content
  can be shared as a template without your progress riding along
- a section index, syntax highlighting, copy buttons
- 18 themes and a font choice, because study reading is long

## What a plugin does

A plugin joins the page build at any of ten stages:

| stage | what it contributes |
|---|---|
| `configure` | validates its own config, fails early |
| `onLesson` | enriches the lesson before anyone draws it |
| `cards` | cards alongside the lesson |
| `transformBody` | rewrites the rendered HTML |
| `styles` / `scripts` / `assets` | what its UI needs |
| `routes` | pages of its own |
| `menuItems` | entries in the sidebar |
| `validate` | findings for the repository check |

**The order is the contract.** A plugin declared after another sees what the
previous one produced — which is how one plugin uses another's work without
importing it. The electronics plugin reads the parts the inventory plugin
resolved; neither knows the other exists.

Two natures of stage, and they are not interchangeable:

- **collecting** (`cards`, `routes`, `assets`…) gathers from everyone
- **piping** (`onLesson`, `transformBody`) hands the value down the line

`collect()` is always async, even for stages that happen to be synchronous
today: a caller forced to know which stages read files gets it wrong the first
time one starts to.

## Native plugins

- [`@bancada/inventory`](https://github.com/HenriqueArtur/bancada-inventory) —
  what you own, how much, and what each lesson consumes
- [`@bancada/electronics`](https://github.com/HenriqueArtur/bancada-electronics) —
  ESP32 pin rules and a circuit drawing from `diagram.json`

## Config

One `bancada.config.json` at the repository root. It holds what would
otherwise be hardcoded — the vocabulary, the note sections, the theme, the UI
strings — and declares the plugins with each one's settings.

```json
{
  "title": "Electronics",
  "content": { "lessons": "lessons", "reference": "reference", "mine": "mine" },
  "notes": { "sections": ["What went wrong", "What I did not understand"] },
  "plugins": [
    { "name": "inventory", "script": "@bancada/inventory", "config": { "file": "inventory.yml" } }
  ]
}
```

Labels default to English. A repository in another language overrides only what
it needs — a public shell cannot hardcode one language, and a half-translated
page is worse than an English one.

## License

MIT.
