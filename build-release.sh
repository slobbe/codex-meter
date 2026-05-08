#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_FILE="${SCRIPT_DIR}/package.json"
METADATA_FILE="${SCRIPT_DIR}/metadata.json"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

read_json_string() {
    local file="$1"
    local key="$2"

    sed -nE "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p" "${file}" | head -n 1
}

require_command make
require_command node
require_command npm
require_command zip
require_command glib-compile-schemas

if [[ ! -f "${PACKAGE_FILE}" ]]; then
    printf 'Missing package file: %s\n' "${PACKAGE_FILE}" >&2
    exit 1
fi

if [[ ! -f "${METADATA_FILE}" ]]; then
    printf 'Missing metadata file: %s\n' "${METADATA_FILE}" >&2
    exit 1
fi

UUID="$(read_json_string "${METADATA_FILE}" uuid)"
VERSION="$(node -p "require('${PACKAGE_FILE}').version")"
BUNDLE="${SCRIPT_DIR}/${UUID}-${VERSION}.zip"

if [[ -z "${UUID}" ]]; then
    printf 'Unable to read "uuid" from %s\n' "${METADATA_FILE}" >&2
    exit 1
fi

if [[ -z "${VERSION}" ]]; then
    printf 'Unable to read "version" from %s\n' "${PACKAGE_FILE}" >&2
    exit 1
fi

printf 'Building release bundle with Makefile...\n'
make -C "${SCRIPT_DIR}" clean pack

if [[ ! -f "${BUNDLE}" ]]; then
    printf 'Expected release bundle was not created: %s\n' "${BUNDLE}" >&2
    exit 1
fi

printf 'Release bundle ready: %s\n' "${BUNDLE}"
