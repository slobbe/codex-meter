<div align="center">
  <h1>Codex Meter</h1>
  <p>A GNOME Shell extension to monitor and manage Codex usage limits from your top bar.</p>
  <p>
    <a href="https://extensions.gnome.org/extension/9993/codex-meter/"><img src="https://img.shields.io/gnome-extensions/v/codex-meter%40slobbe.github.io?label=GNOME%20Extensions&logo=gnome&color=blue" alt="GNOME Extensions version"></a>
    <a href="https://extensions.gnome.org/extension/9993/codex-meter/"><img src="https://img.shields.io/gnome-extensions/dt/codex-meter%40slobbe.github.io?logo=gnome&color=blue" alt="GNOME Extensions downloads"></a>
    <a href="#requirements"><img src="https://img.shields.io/badge/GNOME_Shell_Version-45--50-blue?logo=gnome" alt="GNOME Shell 45-50"></a>
    <a href="https://github.com/slobbe/codex-meter/actions/workflows/ci.yml"><img src="https://github.com/slobbe/codex-meter/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  </p>
</div>
<p align="center">
  <img src="docs/assets/screens/preview.png" width="512" style="border-radius: 25px" alt="Codex Meter preview">
</p>

## Features

- 5-hour and weekly Codex usage limits.
- Usage trends and limit-hit predictions.
- Banked reset redemption.
- Automatic redemption of banked resets before expiration.

## Requirements

- [ChatGPT desktop app](https://chatgpt.com/download/) or [Codex CLI](https://developers.openai.com/codex/cli), signed in with your ChatGPT account on the same machine
- GNOME Shell 45+

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

Codex Meter reads credentials from `~/.codex/auth.json` to request usage and banked reset data from ChatGPT. It does not store credentials or send them anywhere else.

Usage data is cached locally in `~/.cache/codex-meter` and `~/.local/state/codex-meter`, with history kept for roughly 21 days (up to 25,000 entries).

## License

[GPL-3.0-or-later](LICENSE)

<div align="center">
<i>Not affiliated with or endorsed by OpenAI.</i>
</div>
