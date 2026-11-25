# Changelog

All notable changes from version 0.10.0 onward will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] v0.13.0

### Added

- Added a setting to select a local credentials file. The default is `~/.codex/auth.json`.
- Added optional alerts when quota runs low, runs out, or resets on schedule after exhaustion. The low-quota threshold is configurable.
- Added an About window in preferences with the version, release notes, credits, license, and project links.

### Changed

- The Refresh button updates both usage and banked resets.
- Replaced the configurable auto-redemption threshold with a fixed trigger below 2% remaining quota.
- Replaced the auto-redemption window selector with a skip period before the scheduled reset for each window.
- The manual redemption dialog shows how soon a window will reset if it is within its skip period. Cancel has initial keyboard focus.
- Replaced the weekly activity chart with a four-week grid with six-hour blocks in the GNOME accent color.
- Kept cached usage and history separate by account and credentials file. The first time the extension runs with the default credentials file, it imports v0.12 usage data.
- Increased local usage history retention from 21 to 30 days.
- Moved popup warnings and errors above the footer. Improved readability and made keyboard focus easier to see.
- Improved screen reader access to panel quota values and the reset confirmation.

### Fixed

- Fixed preferences not opening on GNOME Shell 45 and 46.
- Fixed reset confirmation when GNOME animations are off.
- Prevented redemption if the active account changes after a banked reset is selected.
- Fixed low-quota auto-redemption missing a trigger during an expiry check or selecting the wrong reset when an expiry date is missing.
- Fixed the delay in checking banked resets after turning automatic redemption off and back on.
- Fixed expired resets and stale expiry times appearing when the menu opens.
- Fixed unavailable resets remaining in the menu after a redemption attempt.
- Fixed refreshes not timing out when a server sends data too slowly.
- Fixed the refresh interval control accepting values above 30 minutes.
- Disabled editing for preferences locked by system policy.
- Fixed damaged history entries hiding valid usage history.
- Fixed partial writes truncating new usage history entries.
- Fixed pauses in GNOME Shell when processing large usage histories.
- Fixed the usage menu showing a full quota bar while loading.

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
- Fixed usage history remaining on disk beyond its retention limits.

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
