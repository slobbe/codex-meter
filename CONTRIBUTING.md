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
npm test
```

Source files run directly as JavaScript. Critical pure modules opt into TypeScript's
no-output checker with `// @ts-check` and JSDoc annotations; dynamic GJS UI modules
are covered by runtime tests and manual extension testing.

## Guidelines

- Keep changes small and focused.
- Update tests when changing behavior.
- Update the README when user-facing behavior changes.
- Prefer existing patterns over new dependencies.
- Do not commit generated bundles or `node_modules`.
