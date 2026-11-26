<div align="center">
  <h1>Codex Meter</h1>
  <p>Codex usage limits and resets from your GNOME panel.</p>
  <p>
    <a href="https://extensions.gnome.org/extension/9993/codex-meter/"><img src="https://img.shields.io/gnome-extensions/v/codex-meter%40slobbe.github.io?label=GNOME%20Extensions&logo=gnome&color=blue" alt="GNOME Extensions version"></a>
    <a href="https://extensions.gnome.org/extension/9993/codex-meter/"><img src="https://img.shields.io/gnome-extensions/dt/codex-meter%40slobbe.github.io?logo=gnome&color=blue&label=Downloads" alt="GNOME Extensions downloads"></a>
    <a href="#requirements"><img src="https://img.shields.io/badge/Shell_versions-45--51-blue?logo=gnome" alt="GNOME Shell 45-51"></a>
    <a href="https://github.com/slobbe/codex-meter/blob/main/LICENSE"><img alt="GitHub License" src="https://img.shields.io/github/license/slobbe/codex-meter"></a>
    <a href="https://github.com/slobbe/codex-meter/actions/workflows/ci.yml"><img src="https://github.com/slobbe/codex-meter/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  </p>
</div>
<p align="center">
  <img src="docs/assets/preview.png" width="512" alt="Codex Meter preview">
</p>

A GNOME Shell extension that shows your Codex usage limits, resets, and usage trends from the panel.

## Features

- **Usage limits**: Track remaining or used quota for your Codex usage windows.
- **Usage pace**: See usage trends and estimates of whether your quota will last until it resets.
- **Banked resets**: Redeem individual resets or enable automatic redemption before expiry or when quota runs low.
- **Display options**: Choose between percentages, bars or circular progress indicators.
- **Notifications**: Get alerts when a usage window runs low, is exhausted, or resets after exhaustion.

## Requirements

- GNOME Shell 45–51.
- [Codex CLI](https://developers.openai.com/codex/cli) or the [ChatGPT desktop app](https://chatgpt.com/download/), signed in with your ChatGPT account on the same machine.

## Install

### GNOME Extensions

Codex Meter is available from [GNOME Extensions](https://extensions.gnome.org/extension/9993/codex-meter/).

### Manual installation

Alternatively, install from a GitHub release:

1. Download the zip from the [latest release](https://github.com/slobbe/codex-meter/releases/latest).
2. Install and enable the extension with:

```sh
gnome-extensions install --force codex-meter@slobbe.github.io-<version>.zip
gnome-extensions enable codex-meter@slobbe.github.io
```

If GNOME does not pick it up immediately, log out and back in.

## Uninstall

To uninstall:

```sh
gnome-extensions uninstall codex-meter@slobbe.github.io
```

## Troubleshooting

- **Extension not showing:** check that it is enabled, then log out and back in.
- **Usage not loading or authentication expired:** sign back in through the ChatGPT desktop app or Codex CLI, and check your internet connection.
- **Still stuck:** [open an issue](https://github.com/slobbe/codex-meter/issues) with your GNOME Shell version and the error message. Never share your auth file or tokens.

## Limitations

Codex Meter relies on ChatGPT backend endpoints, so upstream changes may affect functionality.

## Privacy

Codex Meter reads authentication credentials from the file selected in Preferences (default `~/.codex/auth.json`) to request usage and banked reset data from ChatGPT. It does not store or modify the credentials or send them anywhere else.

Codex Meter caches usage data in `~/.cache/codex-meter` and `~/.local/state/codex-meter`. It uses up to 30 days of usage history, with a limit of 25,000 entries. It removes older entries from disk in batches.

## License

[GPL-3.0-or-later](LICENSE)

## Disclaimer

This extension is not affiliated with or endorsed by OpenAI.
