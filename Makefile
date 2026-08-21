NAME=codex-meter
DOMAIN=slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
TAG_VERSION=v$(VERSION)
ZIP=$(NAME)@$(DOMAIN)-$(TAG_VERSION).zip
.PHONY: all check pack install reload clean

all: check

check:
	npm test

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
