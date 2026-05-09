NAME=codex-meter
DOMAIN=slobbe.github.io
VERSION=$(shell node -p "require('./package.json').version")
TAG_VERSION=v$(VERSION)
ZIP=$(NAME)@$(DOMAIN)-$(TAG_VERSION).zip
TS_SOURCES=$(shell find . -path ./dist -prune -o -path ./node_modules -prune -o -name "*.ts" -print)

.PHONY: all pack install clean

all: dist/extension.js

node_modules/.package-lock.json: package.json
	npm install

dist/extension.js dist/prefs.js &: node_modules/.package-lock.json $(TS_SOURCES)
	rm -rf dist
	npm run build

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.$(NAME).gschema.xml
	glib-compile-schemas schemas

$(ZIP): dist/extension.js dist/prefs.js schemas/gschemas.compiled metadata.json src/stylesheet.css
	@cp -r schemas dist/
	@cp metadata.json dist/
	@cp src/stylesheet.css dist/stylesheet.css
	@rm -f $(ZIP)
	@(cd dist && zip ../$(ZIP) -9r .)

pack: $(ZIP)

install: $(ZIP)
	gnome-extensions install --force $(ZIP)

clean:
	@rm -rf dist node_modules $(ZIP)
