# Contributing

## Development

Install the extension and reload it after making changes:

```sh
make install
make reload
```

You may need to log out and back in to see changes.

## Build

To build a release bundle locally:

```sh
make pack
```

## Checks

Install development dependencies, then run all checks before submitting changes:

```sh
npm ci
make check
```

`make check` runs formatting and JSDoc checks, Node unit tests, GJS storage and module
compatibility tests, and GSettings schema validation. Dynamic GNOME Shell UI modules
still require manual extension testing.

## Guidelines

- Keep changes small and focused.
- Update tests when changing behavior.
- Update the README when user-facing behavior changes.
- Prefer existing patterns over new dependencies.
- Do not commit generated bundles or `node_modules`.
