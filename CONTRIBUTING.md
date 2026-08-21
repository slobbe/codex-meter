# Contributing

## Development

For local development, run the following commands to try out changes:

```sh
make clean install
make reload
```

You may need to log out and back in to see changes.

## Build

To build a release bundle locally:

```sh
make clean pack
```

## Checks

Run the checked-JavaScript validation and test suite before submitting changes:

```sh
npm run check
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
