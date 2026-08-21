const modules = [
    "../src/banked-resets/api.js",
    "../src/banked-resets/response.js",
    "../src/banked-resets/store.js",
    "../src/codex/auth.js",
    "../src/codex/auth-parser.js",
    "../src/codex/usage.js",
    "../src/codex/usage-response.js",
    "../src/io/files.js",
    "../src/io/http.js",
    "../src/io/paths.js",
    "../src/panel/refresh-error-message.js",
    "../src/panel/view-model.js",
    "../src/preferences/settings.js",
    "../src/refresh/error.js",
    "../src/refresh/scheduler.js",
    "../src/usage/history-store.js",
    "../src/usage/model.js",
    "../src/usage/prediction.js",
    "../src/usage/service.js",
    "../src/usage/snapshot-store.js",
];

for (const module of modules) {
    await import(module);
}

console.log(`Imported ${modules.length} modules with GJS.`);
