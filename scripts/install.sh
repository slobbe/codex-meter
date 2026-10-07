#!/bin/sh
set -eu

REPOSITORY=slobbe/codex-meter
UUID=codex-meter@slobbe.github.io
API_URL="https://api.github.com/repos/$REPOSITORY/releases"

usage() {
    printf '%s\n' 'Usage: sh install.sh [--help]' \
        'Install the latest stable release.'
}

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}


case "$#" in
    0) ;;
    1)
        case "$1" in

            --help|-h) usage; exit 0 ;;
            *) usage >&2; exit 1 ;;
        esac
        ;;
    *) usage >&2; exit 1 ;;
esac

for command in curl jq gnome-extensions mktemp; do
    command -v "$command" >/dev/null 2>&1 || fail "Required command not found: $command"
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM

fetch_release() {
    curl --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 15 --max-time 60 \
        --header 'Accept: application/vnd.github+json' \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        "$1" --output "$2" || fail 'Could not fetch releases from GitHub. Check your connection and GitHub API rate limits.'
}

printf '%s\n' 'Finding the latest stable release...'
fetch_release "$API_URL/latest" "$stage/release.json"
jq -e '.draft == false and .prerelease == false' "$stage/release.json" >/dev/null \
    || fail 'GitHub did not return a stable release.'

tag=$(jq -er '.tag_name | select(type == "string" and length > 0)' "$stage/release.json") \
    || fail 'The selected release has no version tag.'
asset_name="$UUID-v${tag#v}.zip"
asset_url=$(jq -er --arg name "$asset_name" '
    [.assets[]? | select(.name == $name)]
    | select(length == 1)
    | .[0].browser_download_url
    | select(type == "string" and startswith("https://github.com/slobbe/codex-meter/releases/download/"))
' "$stage/release.json") || fail "Release $tag does not contain the expected extension zip: $asset_name"

printf 'Downloading %s...\n' "$tag"
curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    "$asset_url" --output "$stage/extension.zip" \
    || fail "Could not download release $tag."

gnome-extensions install --force "$stage/extension.zip" \
    || fail 'GNOME could not install the extension.'
printf 'Installed Codex Meter %s.\n' "$tag"

if gnome-extensions enable "$UUID"; then
    printf '%s\n' 'Extension enabled. If it does not appear or still shows an older version, log out and back in.'
else
    printf '%s\n' 'Installation succeeded, but GNOME could not enable the extension yet.' \
        'Log out and back in, then enable Codex Meter in the Extensions app.'
fi
