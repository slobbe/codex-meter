NAME=codex-meter
DOMAIN=slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
TAG_VERSION=v$(VERSION)
ZIP=$(NAME)@$(DOMAIN)-$(TAG_VERSION).zip
.PHONY: all check check-js check-gjs check-schemas version pack release install reload clean

all: check

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
	@rm -f $(ZIP)
	@(cd src && zip ../$(ZIP) -9r . -x '*.compiled')

release: check
	$(MAKE) pack

install: pack
	gnome-extensions install --force $(ZIP)

reload:
	gnome-extensions disable codex-meter@slobbe.github.io
	$(MAKE) install
	gnome-extensions enable codex-meter@slobbe.github.io
	$(MAKE) clean

clean:
	@rm -f $(ZIP)
