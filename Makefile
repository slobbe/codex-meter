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
		'  make check-js                Run formatting, JSDoc checks, and Node tests' \
		'  make check-gjs               Run GJS module and storage tests' \
		'  make check-schemas           Validate GSettings schemas' \
		'  make pack                    Build a release-format zip (does not publish)' \
		'' \
		'Local development commands:' \
		'  make help                    Show this help (also the default target)' \
		'  make install                 Build and install a dev-marked extension' \
		'  make reload                  Disable, rebuild, reinstall, enable, and clean' \
		'  make version VERSION=x.y.z   Update version declarations (no commit or tag)' \
		'  make clean                   Remove release and dev zips for the current version' \
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

check-schemas:
	glib-compile-schemas --strict --dry-run src/schemas

version:
	@if [ "$(origin VERSION)" != "command line" ]; then echo "Usage: make version VERSION=x.y.z"; exit 1; fi
	@if git rev-parse --verify --quiet "refs/tags/v$(VERSION)" >/dev/null; then echo "Error: Git tag v$(VERSION) already exists; Git tags cannot be overwritten."; exit 1; fi
	@npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null
	@node -e "const fs = require('node:fs'); const path = 'src/metadata.json'; const metadata = JSON.parse(fs.readFileSync(path, 'utf8')); metadata['version-name'] = '$(VERSION)'; fs.writeFileSync(path, JSON.stringify(metadata, null, 4) + '\n');"
	@npx prettier --write src/metadata.json >/dev/null
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
