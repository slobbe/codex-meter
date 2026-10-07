import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/install.sh", import.meta.url));
const uuid = "codex-meter@slobbe.github.io";
const apiUrl = "https://api.github.com/repos/slobbe/codex-meter/releases";
const jqAvailable = spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const testOptions = { skip: jqAvailable ? false : "jq is unavailable" };

function release(tag = "v1.2.3", overrides = {}) {
    const name = `${uuid}-v${tag.replace(/^v/, "")}.zip`;
    return {
        tag_name: tag,
        draft: false,
        prerelease: false,
        assets: [
            {
                name,
                browser_download_url: `https://github.com/slobbe/codex-meter/releases/download/${tag}/${name}`,
            },
        ],
        ...overrides,
    };
}

// Both commands are replaced, and unexpected URLs fail rather than reaching the network.
const mockCommand = String.raw`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.env.INSTALL_TEST_CONFIG, "utf8"));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_TEST_LOG, JSON.stringify({ command, args }) + "\n");
if (command === "curl") {
    const url = args.find(arg => arg.startsWith("https://"));
    const output = args[args.indexOf("--output") + 1];
    const response = config.responses[url];
    if (!response || !output) {
        console.error("Unexpected curl request: " + JSON.stringify(args));
        process.exit(99);
    }
    fs.writeFileSync(output, response.body);
    process.exit(response.status || 0);
}
if (args[0] === "install") {
    if (args[1] !== "--force" || fs.readFileSync(args[2], "utf8") !== "mock extension zip") {
        console.error("Unexpected install arguments or archive");
        process.exit(99);
    }
    process.exit(config.installStatus);
}
if (args[0] === "enable" && args[1] === config.uuid) {
    process.exit(config.enableStatus);
}
console.error("Unexpected GNOME command: " + JSON.stringify(args));
process.exit(99);
`;

function runInstaller(
    t,
    {
        args = [],
        latest = release(),
        fetchStatus = 0,
        downloadStatus = 0,
        installStatus = 0,
        enableStatus = 0,
    } = {},
) {
    const root = mkdtempSync(join(tmpdir(), "codex-meter-install-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    const stage = join(root, "tmp");
    const home = join(root, "home");
    for (const directory of [bin, stage, home]) {
        mkdirSync(directory);
    }
    for (const command of ["curl", "gnome-extensions"]) {
        writeFileSync(join(bin, command), mockCommand, { mode: 0o755 });
    }

    const responses = {
        [`${apiUrl}/latest`]: { body: JSON.stringify(latest), status: fetchStatus },
    };
    for (const asset of latest.assets ?? []) {
        responses[asset.browser_download_url] = {
            body: "mock extension zip",
            status: downloadStatus,
        };
    }
    const config = join(root, "config.json");
    const log = join(root, "calls.jsonl");
    writeFileSync(config, JSON.stringify({ responses, installStatus, enableStatus, uuid }));
    writeFileSync(log, "");

    const result = spawnSync("sh", [script, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
            HOME: home,
            TMPDIR: stage,
            INSTALL_TEST_CONFIG: config,
            INSTALL_TEST_LOG: log,
        },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    const calls = readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    for (const call of calls.filter((call) => call.command === "curl")) {
        const output = call.args[call.args.indexOf("--output") + 1];
        assert.equal(dirname(dirname(output)), stage, "downloads must use the staging directory");
    }
    assert.deepEqual(readdirSync(stage), [], "installer must remove its temporary files");
    return {
        ...result,
        calls,
        urls: calls
            .filter((call) => call.command === "curl")
            .map((call) => call.args.find((arg) => arg.startsWith("https://"))),
        gnome: calls.filter((call) => call.command === "gnome-extensions").map((call) => call.args),
    };
}

function assertInstalled(result, selected) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.urls.at(-1), selected.assets[0].browser_download_url);
    assert.equal(result.gnome.length, 2);
    assert.deepEqual(result.gnome[0].slice(0, 2), ["install", "--force"]);
    const download = result.calls.filter((call) => call.command === "curl").at(-1);
    assert.equal(result.gnome[0][2], download.args[download.args.indexOf("--output") + 1]);
    assert.deepEqual(result.gnome[1], ["enable", uuid]);
    assert.ok(result.stdout.includes(`Installed Codex Meter ${selected.tag_name}.`));
}

for (const tag of ["v1.2.3", "1.2.3"]) {
    test(`default mode installs stable release ${tag} and cleans up`, testOptions, (t) => {
        const latest = release(tag);
        const result = runInstaller(t, { latest });
        assertInstalled(result, latest);
        assert.deepEqual(result.urls, [`${apiUrl}/latest`, latest.assets[0].browser_download_url]);
        assert.match(result.stdout, /Finding the latest stable release/);
        assert.match(result.stdout, /Extension enabled.*log out and back in/);
    });
}

for (const flag of ["draft", "prerelease"]) {
    test(
        `latest endpoint rejects ${flag} data without downloading or installing`,
        testOptions,
        (t) => {
            const latest = release("v1.2.3", { [flag]: true });
            const result = runInstaller(t, { latest });
            assert.equal(result.status, 1);
            assert.match(result.stderr, /GitHub did not return a stable release/);
            assert.deepEqual(result.urls, [`${apiUrl}/latest`]);
            assert.deepEqual(result.gnome, []);
        },
    );
}

test("missing expected asset fails without downloading or installing", testOptions, (t) => {
    const latest = release();
    latest.assets[0].name = "unrelated.zip";
    const result = runInstaller(t, { latest });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`expected extension zip: ${uuid}-v1.2.3.zip`));
    assert.deepEqual(result.urls, [`${apiUrl}/latest`]);
    assert.deepEqual(result.gnome, []);
});

test("release fetch failure reports API guidance and cleans up", testOptions, (t) => {
    const result = runInstaller(t, { fetchStatus: 22 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not fetch releases from GitHub.*rate limits/);
    assert.deepEqual(result.urls, [`${apiUrl}/latest`]);
    assert.deepEqual(result.gnome, []);
});

test("download failure does not install and removes the partial download", testOptions, (t) => {
    const result = runInstaller(t, { downloadStatus: 22 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not download release v1\.2\.3/);
    assert.equal(result.urls.length, 2);
    assert.deepEqual(result.gnome, []);
    assert.doesNotMatch(result.stdout, /Installed Codex Meter/);
});

test("install failure does not enable and cleans up", testOptions, (t) => {
    const result = runInstaller(t, { installStatus: 1 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GNOME could not install the extension/);
    assert.equal(result.gnome.length, 1);
    assert.equal(result.gnome[0][0], "install");
    assert.doesNotMatch(result.stdout, /Installed Codex Meter/);
});

test("enable failure still succeeds with actionable guidance and cleans up", testOptions, (t) => {
    const latest = release();
    const result = runInstaller(t, { latest, enableStatus: 1 });
    assertInstalled(result, latest);
    assert.match(result.stdout, /Installation succeeded, but GNOME could not enable/);
    assert.match(
        result.stdout,
        /Log out and back in, then enable Codex Meter in the Extensions app/,
    );
    assert.doesNotMatch(result.stdout, /Extension enabled\./);
});

for (const args of [
    ["--unknown"],
    ["--prerelease"],
    ["--prerelease", "extra"],
    ["--help", "extra"],
]) {
    test(`rejects invalid arguments: ${args.join(" ")}`, testOptions, (t) => {
        const result = runInstaller(t, { args });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Usage: sh install\.sh \[--help\]/);
        assert.equal(result.stdout, "");
        assert.deepEqual(result.calls, []);
    });
}

for (const flag of ["--help", "-h"]) {
    test(`${flag} prints help without fetching or installing`, testOptions, (t) => {
        const result = runInstaller(t, { args: [flag] });
        assert.equal(result.status, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Usage: sh install\.sh \[--help\]/);
        assert.match(result.stdout, /Install the latest stable release\./);
        assert.deepEqual(result.calls, []);
    });
}
