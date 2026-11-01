import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../.github/release-notes.js", import.meta.url));

function extractNotes(t, changelog, tag) {
    const directory = mkdtempSync(join(tmpdir(), "codex-meter-release-notes-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "CHANGELOG.md"), changelog);
    return spawnSync(process.execPath, [script, tag], {
        cwd: directory,
        encoding: "utf8",
    });
}

const changelog = `# Changelog

## v0.10.2 (unreleased)

### Changed

- Latest change.

## v0.10.1 (2026-10-31)

### New

- A feature.

### Fixed

- A fix with **Markdown** and \`code\`.

## v0.10.0 (2026-10-31)

### Changed

- Older change.
`;

test("release notes contain only the matching version body and preserve Markdown", (t) => {
    const result = extractNotes(t, changelog, "v0.10.1");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        result.stdout,
        "### New\n\n- A feature.\n\n### Fixed\n\n- A fix with **Markdown** and `code`.\n",
    );
});

test("release notes support the latest entry marked as unreleased", (t) => {
    const result = extractNotes(t, changelog, "v0.10.2");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "### Changed\n\n- Latest change.\n");
});

test("release notes support the last entry and Windows line endings", (t) => {
    const result = extractNotes(t, changelog.replaceAll("\n", "\r\n"), "v0.10.0");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "### Changed\n\n- Older change.\n");
});

test("release notes fail when the version is missing rather than matching a prefix", (t) => {
    const result = extractNotes(t, "## v0.10.10 (2026-11-01)\n\n- A change.\n", "v0.10.1");

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No changelog entry found for v0\.10\.1/);
    assert.equal(result.stdout, "");
});

test("release notes fail when the matching entry is empty", (t) => {
    const result = extractNotes(
        t,
        "## v0.10.1 (2026-10-31)\n\n## v0.10.0 (2026-10-31)\n\n- Older change.\n",
        "v0.10.1",
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Changelog entry for v0\.10\.1 is empty/);
    assert.equal(result.stdout, "");
});
