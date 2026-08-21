# Contributing

## Development

Install the extension initially with:

```sh
make install
```

After making changes, rebuild, reinstall, and reload it with:

```sh
make reload
```

`make reload` disables the extension, runs `make install`, and enables it again. You may
need to log out and back in if GNOME does not pick up the changes.

## Build

To build an extension bundle locally:

```sh
make pack
```

To update all version declarations:

```sh
make version VERSION=0.9.2
```

To run all checks and then build the versioned release bundle:

```sh
make release
```

`make version` only updates the version; it does not create a commit, tag, or bundle.

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
