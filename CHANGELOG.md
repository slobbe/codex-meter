# Changelog

All notable changes from version 0.10.0 onward will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] v0.13.0

### Added

- Added configurable path for authentication credentials (default `~/.codex/auth.json`).
- Added optional notifications for low usage, exhausted windows, and scheduled resets after exhaustion, with a configurable warning threshold.
- Added About window in preferences with details, version, changelog, credits, license, and project links.

### Changed

- Changed low-usage auto-redemption to use a fixed threshold of less than 2% quota remaining.
- Replaced the window selector with a skip period in minutes for each window.
- Manual redemption shows the time left when a scheduled reset is close.
- Changed popup warning and error messages to appear above the footer.
- Changed the activity chart to a four-week grid with six-hour blocks that use the GNOME accent color.
- Increased local usage history retention from 21 to 30 days.

### Fixed

- Automatically migrated v0.12 usage data to the default account on first use.
- Fixed activity grid cells appearing as thin horizontal lines.
- Fixed preferences not opening on GNOME Shell 45 and 46.
- Prevented reset redemption for the wrong account when the credentials file changes.
- Prevented usage data from a previous account appearing after an account change.
- Fixed reset confirmation with animations off. Enter no longer redeems a reset by default.
- Fixed automatic redemption missing a low-quota trigger or selecting the wrong expiration date.
- Prevented automatic redemption after its trigger no longer applies or a previous redemption is still unresolved.
- Fixed expired resets and stale expiry times in the menu.
- Fixed unavailable resets remaining in the menu after a redemption attempt.
- Fixed queued usage alerts appearing after an account change or after notifications are turned off.
- Fixed slow network responses keeping a refresh open indefinitely.
- Fixed the refresh interval control accepting values above 30 minutes.
- Fixed damaged history entries hiding valid usage history.
- Fixed pauses in GNOME Shell when processing large usage histories.
- Improved keyboard and screen reader access to the activity chart, panel quota values, and reset confirmation.
- Improved the readability and keyboard focus of warning and error messages.
- Fixed the usage menu showing a full quota bar while loading.
- Added an error message when the credentials chooser selects a non-local file.

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
