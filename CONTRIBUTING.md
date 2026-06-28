# Contributing

## Development

For local development, run the following commands to try out changes:

```sh
make clean install
gnome-extensions disable codex-meter@slobbe.github.io
gnome-extensions enable codex-meter@slobbe.github.io
```

You may need to log out and back in to see changes.

## Build

To build a release bundle locally:

```sh
make clean pack
```

## Checks

Run the test suite before submitting changes:

```sh
npm test
```

## Guidelines

- Keep changes small and focused.
- Update tests when changing behavior.
- Update the README when user-facing behavior changes.
- Prefer existing patterns over new dependencies.
- Do not commit generated bundles or `node_modules`.
