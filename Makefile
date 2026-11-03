UUID=codex-meter@slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
DEV=0
BUILD_VERSION=$(VERSION)$(if $(filter 1,$(DEV)),-dev)
ZIP=$(UUID)-v$(BUILD_VERSION).zip

.DEFAULT_GOAL := help
.PHONY: help check check-js check-gjs check-schemas version pack install reload clean

help:
	@printf '%s\n' \
		'Pipeline commands:' \
		'  make check                   Run all checks and tests' \
		'  make pack                    Build a release-format zip (does not publish)' \
		'' \
		'Local development commands:' \
		'  make install                 Build and install a dev-marked extension' \
		'  make reload                  Disable, rebuild, reinstall, enable, and clean' \
		'  make clean                   Remove release and dev zips for the current version' \
		'  make prepare VERSION=x.y.z   Update versions and date Unreleased notes (no commit or tag)' \
		'' \
		'Run npm ci first to install development dependencies.' \
		'After installing or reloading, log out and back in if changes do not appear.'

check: check-js check-gjs check-schemas

check-js:
	npm run check
	npm test

check-gjs:
	gjs -m test/gjs-smoke.test.js
	gjs -m test/history-storage.test.js
	gjs -m test/lifecycle.gjs.js
	gjs -m test/monitor.gjs.js
	gjs -m test/periodic-task.gjs.js

check-schemas:
	glib-compile-schemas --strict --dry-run src/schemas

prepare:
	@if [ "$(origin VERSION)" != "command line" ]; then echo "Usage: make prepare VERSION=x.y.z"; exit 1; fi
	@if git rev-parse --verify --quiet "refs/tags/v$(VERSION)" >/dev/null; then echo "Error: Git tag v$(VERSION) already exists; Git tags cannot be overwritten."; exit 1; fi
	@grep -q '^## Unreleased[[:space:]]*$$' CHANGELOG.md || { echo 'CHANGELOG.md must contain a ## Unreleased heading.' >&2; exit 1; }
	@npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null
	@sed -i 's/"version-name": "[^"]*"/"version-name": "$(VERSION)"/' src/metadata.json
	@sed -i "s/^## Unreleased[[:space:]]*$$/## v$(VERSION) ($$(date +%F))/" CHANGELOG.md
	@echo "Version set to $(VERSION)."

pack:
	@set -eu; \
	stage=$$(mktemp -d); \
	trap 'rm -rf "$$stage"' EXIT HUP INT TERM; \
	cp -R src/. "$$stage/"; \
	node -e 'const fs = require("node:fs"); const path = process.argv[1]; const metadata = JSON.parse(fs.readFileSync(path, "utf8")); metadata["version-name"] = process.argv[2]; fs.writeFileSync(path, JSON.stringify(metadata, null, 4) + "\n");' "$$stage/metadata.json" "$(BUILD_VERSION)"; \
	rm -f "$(ZIP)"; \
	(cd "$$stage" && zip "$(CURDIR)/$(ZIP)" -9r . -x '*.compiled')

install: DEV=1
install: pack
	gnome-extensions install --force $(ZIP)

reload:
	gnome-extensions disable $(UUID)
	$(MAKE) install
	gnome-extensions enable $(UUID)
	$(MAKE) clean

clean:
	@rm -f $(UUID)-v$(VERSION).zip $(UUID)-v$(VERSION)-dev.zip
