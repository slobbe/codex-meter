# Changelog

All notable changes from version 0.10.0 onward will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## v0.12.0 (2026-11-13)

### Added

- Added GNOME Shell 51 compatibility.
- Added opt-in banked reset auto-redemption when any or a selected usage window falls below a configurable remaining percentage (default 2%).

### Changed

- Changed preferences to group appearance settings together and separate background refresh, with clearer labels and default-first dropdown options.
- Changed popup actions to a compact footer with the last refresh time and Refresh and Preferences icon buttons.
- Changed popup bar colors to reflect usage pace, matching the panel indicator.
- Changed popup pace text to use shorter, clearer quota predictions.
- Changed popup reset labels to show the reset date and time on a separate line.
- Changed duration text to omit zero-valued secondary units.
- Changed banked reset wording to consistently use "redeem" throughout the app and README.
- Changed the banked reset confirmation modal structure.

### Fixed

- Fixed the popup menu changing width when pace text or other content changes.
- Fixed banked reset redemption reporting success when Codex did not reset usage limits.
- Fixed reset confirmation dialogs remaining briefly after the extension is disabled.
- Fixed release and development archives omitting the license text.
- Fixed filesystem operations potentially blocking GNOME Shell on slow storage.

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
