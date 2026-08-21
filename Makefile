NAME=codex-meter
DOMAIN=slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
TAG_VERSION=v$(VERSION)
ZIP=$(NAME)@$(DOMAIN)-$(TAG_VERSION).zip
SOURCES=$(shell find src types -type f -print)

.PHONY: all check pack install reload clean

all: check

node_modules/.package-lock.json: package.json
	npm install

check: node_modules/.package-lock.json
	npm run check

$(ZIP): check $(SOURCES)
	@rm -f $(ZIP)
	@(cd src && zip ../$(ZIP) -9r . -x '*.compiled')

pack: $(ZIP)

install: $(ZIP)
	gnome-extensions install --force $(ZIP)

reload:
	gnome-extensions disable codex-meter@slobbe.github.io
	gnome-extensions enable codex-meter@slobbe.github.io

clean:
	@rm -rf node_modules $(ZIP)
