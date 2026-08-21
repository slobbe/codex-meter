NAME=codex-meter
DOMAIN=slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
TAG_VERSION=v$(VERSION)
ZIP=$(NAME)@$(DOMAIN)-$(TAG_VERSION).zip
.PHONY: all check check-js check-gjs check-schemas pack install reload clean

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

pack:
	@rm -f $(ZIP)
	@(cd src && zip ../$(ZIP) -9r . -x '*.compiled')

install: pack
	gnome-extensions install --force $(ZIP)

reload:
	gnome-extensions disable codex-meter@slobbe.github.io
	gnome-extensions enable codex-meter@slobbe.github.io

clean:
	@rm -f $(ZIP)
