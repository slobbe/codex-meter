# Changelog

All notable changes from version 0.10.0 onward will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Added GNOME Shell 51 compatibility while retaining GNOME Shell 45–50 support.

### Changed

- Changed popup bar colors to reflect usage pace, matching the panel indicator.
- Changed popup pace text to use shorter, clearer quota predictions.
- Changed duration text to omit zero-valued secondary units.
- Changed banked reset wording to consistently use "redeem" throughout the app and README.
- Changed the banked reset confirmation modal structure.

### Fixed

- Fixed the popup menu changing width when pace text or other content changes.
- Fixed banked reset redemption reporting success when Codex did not reset usage limits.

## v0.11.1 (2026-11-03)

### Changed

- Changed HTTP library loading to use the version selected by GNOME Shell.

## v0.11.0 (2026-11-03)

### Changed

- Changed panel bar colors to reflect usage pace rather than remaining capacity; popup bars are unchanged.
- Changed the refresh action label to “Refresh now” while retaining the last refresh time.

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
