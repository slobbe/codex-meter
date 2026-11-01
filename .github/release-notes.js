import { readFileSync } from "node:fs";

const tag = process.argv[2];
if (!tag) {
    throw new Error("Usage: node .github/release-notes.js vMAJOR.MINOR.PATCH");
}

const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## ${tag} (`));
if (start === -1) {
    throw new Error(`No changelog entry found for ${tag}`);
}

const section = lines.slice(start + 1);
const end = section.findIndex((line) => line.startsWith("## "));
const notes = section
    .slice(0, end === -1 ? section.length : end)
    .join("\n")
    .trim();
if (!notes) {
    throw new Error(`Changelog entry for ${tag} is empty`);
}

process.stdout.write(`${notes}\n`);
