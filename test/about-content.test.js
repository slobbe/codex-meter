import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatDescription, parseReleaseNotes } from "../src/preferences/about-content.js";

test("About release notes convert only the latest entry to supported markup", () => {
    const changelog = `# Changelog

## [Unreleased] v0.13.0

### Added

- A feature with \`code\` & <text>.
- Another feature.

### Fixed

- A fix.

## v0.12.0 (2026-11-13)

- Older change.
`;
    const expected = {
        version: "0.13.0",
        markup: "<p><em>Added</em></p>\n<ul>\n<li>A feature with <code>code</code> &amp; &lt;text&gt;.</li>\n<li>Another feature.</li>\n</ul>\n<p><em>Fixed</em></p>\n<ul>\n<li>A fix.</li>\n</ul>",
    };
    assert.deepEqual(parseReleaseNotes(changelog), expected);
    assert.deepEqual(parseReleaseNotes(changelog.replaceAll("\n", "\r\n")), expected);
    assert.deepEqual(
        parseReleaseNotes(changelog.replace("[Unreleased] v0.13.0", "v0.13.0 (2026-11-15)")),
        expected,
    );
});

test("About release notes omit missing or empty entries", () => {
    for (const changelog of [
        "",
        "# Changelog",
        "## Invalid\n- Text",
        "## [Unreleased] v0.13.0\n\n## v0.12.0\n- Older",
    ])
        assert.equal(parseReleaseNotes(changelog), null);
});

test("About descriptions render shared Markdown blocks as safe Pango markup", () => {
    const description =
        "An & <example>.\n\n### Features\n\n- Read `a<b>&c`.\n- Another feature.\n\nA wrapped\nparagraph.";
    const expected =
        "An &amp; &lt;example&gt;.\n\n<b>Features</b>\n\n• Read <tt>a&lt;b&gt;&amp;c</tt>.\n• Another feature.\n\nA wrapped paragraph.";
    assert.equal(formatDescription(description), expected);
    assert.equal(formatDescription(description.replaceAll("\n", "\r\n")), expected);
    assert.equal(formatDescription(""), "");
});

test("About descriptions support common inline Markdown", () => {
    for (const [markdown, expected] of [
        ["**bold** and __strong__", "<b>bold</b> and <b>strong</b>"],
        ["*italic* and _emphasis_", "<i>italic</i> and <i>emphasis</i>"],
        ["***both*** and ~~removed~~", "<b><i>both</i></b> and <s>removed</s>"],
        ["**bold with _italic_**", "<b>bold with <i>italic</i></b>"],
        ["snake_case_name", "snake_case_name"],
        ["`**literal** & <code>`", "<tt>**literal** &amp; &lt;code&gt;</tt>"],
        ["``a `backtick` here``", "<tt>a `backtick` here</tt>"],
        ["\\*literal\\*", "*literal*"],
        ["unclosed **bold and `code", "unclosed **bold and `code"],
        ["<b>raw HTML</b>", "&lt;b&gt;raw HTML&lt;/b&gt;"],
    ])
        assert.equal(formatDescription(markdown), expected, markdown);
});

test("About descriptions render safe links with escaped labels and destinations", () => {
    assert.equal(
        formatDescription('[**Project** & docs](https://example.com/?a=1&b=2 "Title")'),
        '<a href="https://example.com/?a=1&amp;b=2"><b>Project</b> &amp; docs</a>',
    );
    assert.equal(
        formatDescription("[Email](mailto:person@example.com)"),
        '<a href="mailto:person@example.com">Email</a>',
    );
    for (const url of ["javascript:alert", "file:///etc/passwd", "data:text/html,test"])
        assert.ok(!formatDescription(`[Link](${url})`).includes("<a "));
});

test("About descriptions support headings, lists, quotes and fenced code", () => {
    for (const prefix of ["#", "##", "###", "####", "#####", "######"])
        assert.equal(formatDescription(`${prefix} Heading`), "<b>Heading</b>");
    assert.equal(formatDescription("Heading\n======="), "<b>Heading</b>");
    assert.equal(formatDescription("Heading\n-------"), "<b>Heading</b>");
    assert.equal(formatDescription("## Heading ##"), "<b>Heading</b>");
    assert.equal(formatDescription("* First\n+ Second\n- Third"), "• First\n• Second\n• Third");
    assert.equal(formatDescription("3. First\n4) Second"), "3. First\n4. Second");
    assert.equal(
        formatDescription("- A wrapped\n  list item\n- Next"),
        "• A wrapped list item\n• Next",
    );
    assert.equal(
        formatDescription("> A **quote**\n> continued"),
        "<i>A <b>quote</b> continued</i>",
    );
    assert.equal(
        formatDescription("```js\n  **literal**\n\n<code> & text\n```"),
        "<tt>  **literal**\n\n&lt;code&gt; &amp; text</tt>",
    );
    assert.equal(formatDescription("~~~\n`literal`\n~~~"), "<tt>`literal`</tt>");
    assert.equal(formatDescription("```\nunclosed code"), "<tt>unclosed code</tt>");
});

test("shared Markdown parsing keeps release-note output within AppStream's subset", () => {
    const notes = parseReleaseNotes(
        "## v0.13.0\n\n# Features\n\n1. **Bold** and _italic_\n2. [Docs](https://example.com)\n\n> Quote\n\n```\n**literal** & <code>\n```",
    );
    assert.equal(
        notes.markup,
        "<p><em>Features</em></p>\n<ol>\n<li><em>Bold</em> and <em>italic</em></li>\n<li>Docs (https://example.com)</li>\n</ol>\n<p><em>Quote</em></p>\n<p><code>**literal** &amp; &lt;code&gt;</code></p>",
    );
    assert.ok(!/<(?:b|i|s|tt|a)(?:\s|>)/.test(notes.markup));
});

test("About release notes support the current project changelog", () => {
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const notes = parseReleaseNotes(changelog);
    const metadata = JSON.parse(
        readFileSync(new URL("../src/metadata.json", import.meta.url), "utf8"),
    );
    assert.equal(notes.version, metadata["version-name"]);
    const latest = changelog.split(/^## /m)[1];
    assert.equal((notes.markup.match(/<li>/g) ?? []).length, (latest.match(/^- /gm) ?? []).length);
});
