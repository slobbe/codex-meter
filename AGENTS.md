# Agent Instructions

## Project

Codex Meter is a GNOME Shell extension written in JavaScript ES modules for GJS, supporting GNOME Shell 45–50. Runtime code lives in `src/`; tests live in `test/`.

## GJS Best Practices

- Follow [GJS best practices](https://gjs.guide/guides/gjs/) and the [GNOME Shell extension guidelines](https://gjs.guide/extensions/).
- Follow the [GNOME Shell extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
- Follow the [GNOME Human Interface Guidelines](https://developer.gnome.org/hig/) when designing or changing UI, including preferences.
- Use modern ES modules and `gi://` imports for GNOME libraries. Do not use Node.js or browser-only APIs in extension runtime code.
- Keep Shell code and preferences code separate: Shell uses St/Clutter, while preferences use GTK/Adwaita. Do not import GTK into the Shell process or Shell-only modules into preferences.
- Keep the Shell main loop responsive. Prefer asynchronous Gio APIs and cancellable operations over blocking I/O or synchronous subprocess calls.
- Respect the extension lifecycle: acquire runtime resources in `enable()` and release them in `disable()`. Disconnect signals, remove GLib sources, cancel pending operations, destroy UI actors, and prevent late async callbacks from touching disabled state.
- Use GObject registration and properties/signals where required by the GNOME APIs; follow existing project patterns.
- Keep API usage compatible with the supported GNOME Shell versions. Do not assume APIs from newer releases are available.
- Never log credentials, tokens, or authentication file contents.

## Changes and Validation

- Make focused changes and preserve existing structure and conventions. Avoid unrelated refactors or new dependencies.
- Maintain JSDoc types and the existing formatting style.
- Add or update relevant tests when behavior changes. Node tests cannot validate all GJS or Shell behavior.
- Run relevant checks before finishing:
    - `make check-js`: formatting, type checks, and Node tests.
    - `make check-gjs`: GJS module, storage, and lifecycle-related tests; requires GJS.
    - `make check-schemas`: validate GSettings schemas.
    - `make check`: run all of the above.
- Report what was verified and any checks that could not run. For Shell UI or lifecycle changes, note any manual GNOME Shell testing still needed.

## Changelog

- Keep versions newest first, with pending changes under the latest `## Unreleased` heading.
- When releasing, replace `Unreleased` with the version and release date: `## vX.Y.Z (YYYY-MM-DD)`.
- Use conventional release-note wording: describe new features with `Added`, behavior changes with `Changed`, `Updated`, or `Removed`, and resolved problems with `Fixed` or `Corrected`.
- Phrase fixes around the user-visible problem resolved, not the implementation used to fix it.
- Keep entries concise and short, with one bullet per feature, fix, or change.
- Follow the group order: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`; omit empty groups.
- Use `Added` for new features, `Changed` for changes to existing functionality, `Deprecated` for features planned for removal, `Removed` for removed functionality, `Fixed` for bug fixes, and `Security` for vulnerability fixes.
