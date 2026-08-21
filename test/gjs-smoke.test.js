const modules = [
    "../src/codex/banked-resets/api.js",
    "../src/codex/banked-resets/response.js",
    "../src/codex/banked-resets/store.js",
    "../src/codex/auth/auth.js",
    "../src/codex/auth/auth-parser.js",
    "../src/codex/usage/api.js",
    "../src/codex/usage/response.js",
    "../src/io/files.js",
    "../src/io/http.js",
    "../src/io/paths.js",
    "../src/background/monitor.js",
    "../src/background/refresh-error-message.js",
    "../src/panel/view-model.js",
    "../src/preferences/settings.js",
    "../src/codex/error.js",
    "../src/background/periodic-task.js",
    "../src/codex/usage/history.js",
    "../src/codex/usage/model.js",
    "../src/codex/usage/prediction.js",
    "../src/codex/usage/service.js",
    "../src/codex/usage/snapshot.js",
];

for (const module of modules) {
    await import(module);
}

console.log(`Imported ${modules.length} modules with GJS.`);
