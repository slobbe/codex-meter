# Changelog

All notable changes from version 0.10.0 onward will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- Changed panel bar colors to reflect usage pace rather than remaining capacity; popup bars are unchanged.

### Removed

- Removed the standalone installer in favor of GNOME Extensions and manual installation.
- Removed local disk caching of banked reset details.

## v0.10.1 (2026-10-31)

### Fixed

- Fixed requests and background tasks continuing after the extension was disabled.
- Fixed resource leaks and callbacks accessing closed preferences windows or destroyed panel indicators.

## v0.10.0 (2026-10-31)

### Added

- Added support for variable-length usage windows.
- Added circular panel usage bars with an independent choice of icon style.
- Added individual banked reset selection in the popup menu.
- Added a standalone release installer.

### Changed

- Updated the usage popup to use native GNOME Shell menus.
- Moved banked reset details from preferences to the popup menu.
- Changed the default usage display to remaining capacity.

### Fixed

- Fixed the popup closing during usage refreshes.
- Corrected duration formatting to use the two largest units.
- Fixed preferences window sizing to follow GNOME defaults.
