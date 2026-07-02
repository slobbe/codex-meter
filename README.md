<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/surface.svg?title=Codex+Meter&amp;subtitle=Monitor+and+manage+Codex+usage+limits&amp;logo=https%3A%2F%2Fraw.githubusercontent.com%2Fslobbe%2Fcodex-meter%2Frefs%2Fheads%2Fmain%2Fdocs%2Fassets%2Flogo%2Flogo.svg&amp;mode=dark&amp;border=false" /><img alt="header" src="https://shieldcn.dev/header/surface.svg?title=Codex+Meter&amp;subtitle=Monitor+and+manage+Codex+usage+limits&amp;logo=https%3A%2F%2Fraw.githubusercontent.com%2Fslobbe%2Fcodex-meter%2Frefs%2Fheads%2Fmain%2Fdocs%2Fassets%2Flogo%2Flogo.svg&amp;mode=light&amp;border=false" /></picture>
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/-45%2B.svg?variant=branded&amp;logo=gnome&amp;label=GNOME&amp;color=3b82f6" /><img alt="Custom badge" src="https://shieldcn.dev/badge/-45%2B.svg?variant=branded&amp;mode=light&amp;logo=gnome&amp;label=GNOME&amp;color=3b82f6" /></picture>
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/group/github/slobbe/codex-meter/release+github/slobbe/codex-meter/license.svg?variant=secondary" /><img alt="badge group" src="https://shieldcn.dev/group/github/slobbe/codex-meter/release+github/slobbe/codex-meter/license.svg?variant=secondary&amp;mode=light" /></picture>
</p>

<p align="center">
  <img src="docs/assets/screens/popup.png" width="325" alt="Codex Meter popup preview">
</p>

## Features

- Displays current 5-hour session and weekly Codex usage.
- Shows a weekly usage trend and predicts whether limits will be hit before reset.
- Shows and redeems available banked resets.

## Requirements

- [Codex CLI](https://developers.openai.com/codex/cli) logged in on the same machine
- GNOME Shell 45+

## Install

1. Download the [latest release](https://github.com/slobbe/codex-meter/releases/latest) zip.
2. Install and enable the extension with:

```sh
gnome-extensions install --force codex-meter@slobbe.github.io-<version>.zip
gnome-extensions enable codex-meter@slobbe.github.io
```

If GNOME does not pick it up immediately, log out and back in.

## Privacy

Codex Meter reads your local Codex auth credentials from `~/.codex/auth.json` and uses them to fetch usage and banked reset data from ChatGPT. It does not store those credentials or transmit them anywhere else.

The extension stores non-credential usage data locally so the panel can show cached state, trends, and banked reset information while refreshing. It writes the latest usage and banked-reset snapshots in the user cache directory, typically `~/.cache/codex-meter`, and usage history in the user state directory, typically `~/.local/state/codex-meter`. Usage history is pruned to roughly the last 21 days and at most 25,000 entries. These files are written with private file permissions where supported by the platform.

## License

[GPL-3.0-or-later](LICENSE)
