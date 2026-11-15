/**
 * Convert the latest entry in the project's changelog to libadwaita release notes.
 *
 * @param {string} changelog
 * @returns {{version: string, markup: string} | null}
 */
export function parseReleaseNotes(changelog) {
    const latest = changelog.split(/^## /m)[1];
    if (!latest) return null;
    const [heading, ...lines] = latest.trim().split("\n");
    const version = heading.match(/^(?:\[Unreleased\] )?v(\d+\.\d+\.\d+)/)?.[1];
    if (!version) return null;

    const markup = parseMarkdown(lines.join("\n"))
        .map((block) => {
            if (block.type === "list") {
                const tag = block.ordered ? "ol" : "ul";
                return `<${tag}>\n${block.lines.map((line) => `<li>${formatText(line, "code")}</li>`).join("\n")}\n</${tag}>`;
            }
            if (block.type === "code")
                return `<p><code>${escapeMarkup(block.lines.join("\n"))}</code></p>`;
            const text = formatText(block.lines.join("\n"), "code");
            return ["heading", "quote"].includes(block.type)
                ? `<p><em>${text}</em></p>`
                : `<p>${text}</p>`;
        })
        .join("\n");
    return markup ? { version, markup } : null;
}

/**
 * Format metadata descriptions as Pango markup, not AppStream release-note markup.
 * Supports headings, lists, quotes, fenced code, emphasis, links and inline code.
 * Raw HTML is displayed as text; this is not a full CommonMark implementation.
 *
 * @param {string} description
 * @returns {string}
 */
export function formatDescription(description) {
    return parseMarkdown(description)
        .map((block) => {
            if (block.type === "list")
                return block.lines
                    .map(
                        (line, index) =>
                            `${block.ordered ? `${block.start + index}.` : "•"} ${formatText(line, "tt")}`,
                    )
                    .join("\n");
            if (block.type === "code") return `<tt>${escapeMarkup(block.lines.join("\n"))}</tt>`;
            const text = formatText(block.lines.join("\n"), "tt");
            if (block.type === "heading") return `<b>${text}</b>`;
            if (block.type === "quote") return `<i>${text}</i>`;
            return text;
        })
        .join("\n\n");
}

/** @param {string} markdown */
function parseMarkdown(markdown) {
    /** @type {{type: string, lines: string[], ordered?: boolean, start?: number}[]} */
    const blocks = [];
    let current = null;
    let fence = null;
    for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
        const text = line.trim();
        if (fence) {
            if (new RegExp(`^${fence[0]}{${fence.length},}\\s*$`).test(text)) {
                fence = null;
                current = null;
            } else {
                current.lines.push(line);
            }
            continue;
        }
        const opening = text.match(/^(`{3,}|~{3,})/);
        if (opening) {
            fence = opening[1];
            current = { type: "code", lines: [] };
            blocks.push(current);
            continue;
        }
        if (!text) {
            current = null;
            continue;
        }
        if (current?.type === "paragraph" && /^(?:=+|-+)\s*$/.test(text)) {
            current.type = "heading";
            current = null;
            continue;
        }
        const heading = text.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/);
        const item = text.match(/^(?:[-+*]|(\d+)[.)])\s+(.+)$/);
        const quote = text.match(/^>\s?(.*)$/);
        const type = heading ? "heading" : item ? "list" : quote ? "quote" : "paragraph";
        const ordered = Boolean(item?.[1]);
        if (current?.type === "list" && type === "paragraph" && /^\s+/.test(line)) {
            current.lines[current.lines.length - 1] += `\n${text}`;
            continue;
        }
        if (
            !current ||
            current.type !== type ||
            type === "heading" ||
            (type === "list" && current.ordered !== ordered)
        ) {
            current = { type, lines: [], ordered, start: Number(item?.[1] ?? 1) };
            blocks.push(current);
        }
        current.lines.push(heading?.[1] ?? item?.[2] ?? quote?.[1] ?? text);
    }
    return blocks;
}

/**
 * Render inline Markdown directly to the target markup so generated tags and
 * code spans are never interpreted as Markdown or raw HTML.
 *
 * @param {string} text
 * @param {"code" | "tt"} codeTag
 * @param {number} depth
 */
function formatText(text, codeTag, depth = 0) {
    if (depth >= 20) return escapeMarkup(text);
    let markup = "";
    for (let index = 0; index < text.length;) {
        const rest = text.slice(index);
        const escaped = rest.match(/^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/);
        if (escaped) {
            markup += escapeMarkup(escaped[1]);
            index += escaped[0].length;
            continue;
        }
        const code = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
        if (code) {
            markup += `<${codeTag}>${escapeMarkup(code[2].replaceAll("\n", " "))}</${codeTag}>`;
            index += code[0].length;
            continue;
        }
        const link = rest.match(/^\[([^\]\n]+)\]\(([^\s()]+)(?:\s+"[^"]*")?\)/);
        if (link && /^(?:https?:\/\/|mailto:)/i.test(link[2])) {
            const label = formatText(link[1], codeTag, depth + 1);
            const url = escapeMarkup(link[2]);
            markup += codeTag === "tt" ? `<a href="${url}">${label}</a>` : `${label} (${url})`;
            index += link[0].length;
            continue;
        }
        const delimiter = rest.match(/^(\*\*\*|___|\*\*|__|~~|\*|_)/)?.[1];
        if (
            delimiter &&
            !/\s/.test(rest[delimiter.length] ?? " ") &&
            !(delimiter.includes("_") && /[\p{L}\p{N}]/u.test(text[index - 1] ?? ""))
        ) {
            const end = text.indexOf(delimiter, index + delimiter.length);
            if (end > index + delimiter.length && !/\s/.test(text[end - 1])) {
                const content = formatText(
                    text.slice(index + delimiter.length, end),
                    codeTag,
                    depth + 1,
                );
                if (codeTag === "code") {
                    markup += delimiter === "~~" ? content : `<em>${content}</em>`;
                } else if (delimiter === "~~") {
                    markup += `<s>${content}</s>`;
                } else if (delimiter.length === 3) {
                    markup += `<b><i>${content}</i></b>`;
                } else {
                    const tag = delimiter.length === 2 ? "b" : "i";
                    markup += `<${tag}>${content}</${tag}>`;
                }
                index = end + delimiter.length;
                continue;
            }
        }
        markup += text[index] === "\n" ? " " : escapeMarkup(text[index]);
        index++;
    }
    return markup;
}

/** @param {string} text */
function escapeMarkup(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
