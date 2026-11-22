---
name: gnome-extension-review
description: Review GNOME Shell extensions against official GNOME extension review guidelines, GJS best practices, and GNOME Human Interface Guidelines. Identify compliance issues, lifecycle bugs, resource leaks, performance problems, compatibility risks, and UX issues. Use when reviewing, auditing, or preparing a GNOME Shell extension for publication on extensions.gnome.org.
---

# GNOME Shell Extension Review

Act as an experienced GNOME Shell extension developer and reviewer.

Perform a thorough, evidence-based review of the extension against
official GNOME documentation and established engineering practices.

Prioritize correctness, simplicity, maintainability, and compliance
with the GNOME Extensions review process.

## Principles

- Review the code; do not modify it unless explicitly requested.
- Prefer official GNOME documentation over general JavaScript advice.
- Verify rules against current documentation whenever possible.
- Distinguish mandatory requirements from recommendations.
- Consider the GNOME Shell versions actually supported.
- Never assume an API exists or behaves identically across versions.
- Avoid unnecessary abstractions, defensive code, and complexity.
- Do not recommend changes solely based on personal style.
- Report concrete problems, not hypothetical concerns without evidence.
- Never claim runtime behavior has been verified through static analysis.
- Prefer simple, idiomatic GJS solutions over generic JS patterns.

## Sources of Truth

### Mandatory review guidelines

https://gjs.guide/extensions/review-guidelines/review-guidelines.html

### Extension-specific best practices

https://gjs.guide/extensions/review-guidelines/best-practices.html

### GJS programming guidelines

https://gjs.guide/guides/gjs/
https://gjs.guide/guides/gjs/style-guide.html
https://gjs.guide/guides/gjs/memory-management.html
https://gjs.guide/guides/gjs/asynchronous-programming.html

### Extension development

https://gjs.guide/extensions/
https://gjs.guide/extensions/overview/anatomy.html
https://gjs.guide/extensions/overview/architecture.html
https://gjs.guide/extensions/development/preferences.html
https://gjs.guide/extensions/development/accessibility.html
https://gjs.guide/extensions/overview/updates-and-breakage.html
https://gjs.guide/extensions/development/debugging.html

### User interface

https://developer.gnome.org/hig/

### API reference

https://gjs-docs.gnome.org/

Use version-specific migration guides under:

https://gjs.guide/extensions/

## Review Workflow

### 1. Establish project context

Inspect the repository before evaluating individual files.

Identify:

- Extension purpose and intended behavior
- Supported GNOME Shell versions from `metadata.json`
- Source language and build process
- Entry points: `extension.js`, `prefs.js`
- Supporting modules and dependencies
- GSettings schemas and resources
- Build, packaging, linting, and testing setup

Determine whether the reviewed source is identical to the
distributed extension or requires transpilation/building.

If a distributable ZIP exists, inspect its contents as well.

Do not assume the locally installed GNOME version is the only
supported version.

### 2. Review official compliance

Evaluate the extension against the current EGO review guidelines.

Pay particular attention to:

**Lifecycle**

- No runtime side effects during module import or construction
- Runtime objects and connections created during `enable()`
- All owned resources released during `disable()`
- All signals disconnected
- All main loop sources removed
- Widgets and owned objects destroyed
- Dynamic module-level state cleared
- Shell modifications restored
- No stale references after disabling

**Process isolation**

- No Gtk, Gdk, or Adw imports in the Shell process
- No St, Clutter, Meta, or Shell imports in preferences
- Shared modules do not introduce incompatible imports

**Security and restrictions**

- No prohibited binary executables or libraries
- No obfuscated or minified submitted JavaScript
- No prohibited telemetry
- No unsafe privileged subprocesses
- Clipboard access disclosed and handled according to policy
- No unapproved third-party transmission of clipboard data
- External dependencies and scripts comply with EGO rules
- No deprecated or forbidden modules

**Metadata and distribution**

- Correct UUID and metadata fields
- Valid, accurately declared Shell versions
- Valid GSettings schema ID and path
- Appropriate session modes
- Correct licensing and attribution
- No unnecessary packaged files
- Readable generated JavaScript
- No imaginary or unsupported APIs

Treat documented MUST/MUST NOT requirements as compliance rules.
Treat SHOULD/MAY rules according to their actual wording.

### 3. Review lifecycle and resource ownership

Trace the complete lifecycle:

`import -> construct -> enable -> operate -> disable -> enable`

Inspect every resource created or acquired by the extension:

- GObject signal connections
- GLib timeouts and idle sources
- UI actors and widgets
- GSettings objects and connections
- Gio.Cancellable instances
- Soup sessions and network requests
- File monitors and D-Bus connections
- Subprocesses
- Monkey patches and injected methods
- Global caches and retained references

For each resource, identify:

1. Where it is created
2. Which component owns it
3. Where it is cleaned up
4. Whether callbacks can run after cleanup
5. Whether repeated enable/disable cycles are safe

Prefer having each component manage its own resources.

Do not assume that destroying a parent automatically releases
every unrelated resource or external signal connection.

Pay special attention to asynchronous work completing after
the extension has been disabled.

### 4. Review GJS correctness and compatibility

Check for:

- Idiomatic modern GJS syntax and imports
- Correct GObject APIs and signal handling
- Valid GNOME Shell internal API usage
- Deprecated or removed APIs
- Unsupported imports and library assumptions
- Correct async/await and Gio async patterns
- Correct GVariant and GSettings handling
- Correct text encoding and data conversion
- Proper handling of nullable values and errors
- Compatibility with declared GNOME Shell versions

Verify suspicious APIs against official documentation or the
corresponding GNOME Shell source version.

Do not flag supported APIs merely because an alternative exists.

Avoid recommending compatibility checks for versions the extension
does not support.

### 5. Review performance and responsiveness

GNOME Shell extensions execute within the Shell process.
Performance problems may affect the entire desktop.

Look for:

- Synchronous blocking I/O in the Shell process
- Expensive work on the main thread
- Excessively frequent polling
- Redundant network requests
- Unnecessary UI updates or actor reconstruction
- Expensive work inside signal handlers
- Unbounded collections or caches
- Memory leaks and retained objects
- Excessive logging
- Unnecessary subprocess creation

Assess whether event-driven updates or caching could replace
polling without introducing disproportionate complexity.

For network operations, evaluate timeout, cancellation,
failure handling, and retry behavior.

Avoid speculative optimization suggestions without demonstrating
a plausible bottleneck.

### 6. Review architecture and maintainability

Assess:

- Clear separation of concerns
- Appropriate module boundaries
- Small and understandable entry points
- Explicit resource ownership
- Minimal duplication
- Readable naming and consistent style
- Appropriate error handling
- Minimal unnecessary state
- Reasonable dependency choices
- Testability of non-UI logic

Pay particular attention to patterns discouraged by GNOME
extension best practices:

- Unnecessary try/catch wrappers
- Swallowed exceptions
- Redundant optional chaining for guaranteed APIs
- Unnecessary `typeof` checks
- Defensive lifecycle flags hiding ownership problems
- Excessive wrapper functions or compatibility abstractions
- Large monolithic modules
- Redundant comments explaining obvious code

Do not recommend an abstraction unless it solves a concrete
problem in the existing implementation.

### 7. Review UI, preferences, and accessibility

Use the GNOME Human Interface Guidelines where applicable.

Evaluate:

- Native GNOME interaction patterns
- Correct use of Shell UI components
- GTK4 and Libadwaita preferences
- Appropriate Adw preference groups and rows
- Clear settings labels and descriptions
- Consistent terminology
- Appropriate symbolic icons
- Proper notification behavior
- Accessibility names and descriptions
- Keyboard navigation and focus handling
- Text legibility and scaling
- Localization and translatable strings
- Light/dark theme compatibility
- Empty, loading, and error states

Distinguish Shell-specific UX conventions from application HIG
recommendations. The HIG is primarily written for GTK applications,
and not every pattern applies directly to GNOME Shell.

Do not require elaborate UI for a simple extension.

### 8. Review packaging and tooling

Inspect the actual distributable when available.

Check:

- Required extension files
- Correct metadata and schema packaging
- Valid generated JavaScript
- No accidental development artifacts
- No unnecessary bundled dependencies
- Appropriate licensing files and attribution
- Reproducible build steps
- Existing linting and testing commands

Use existing project tooling where possible.

Run suitable static checks if execution is permitted and the
environment supports them.

Do not install dependencies, alter the system, or start/stop
GNOME Shell without authorization.

If a check cannot be run, state this explicitly.

### 9. Assess runtime verification

When runtime testing is permitted and supported, prioritize:

- Initial enabling
- Repeated enable/disable cycles
- Preferences opening and settings changes
- Network failures and timeouts
- Suspend/resume behavior where relevant
- Lock/unlock transitions where relevant
- Shell version compatibility
- GNOME Shell journal errors

Clearly separate observed runtime failures from risks inferred
through code inspection.

Never claim runtime testing was performed when it was not.

## Findings Classification

Classify each finding along two independent dimensions.

### Severity

- **Critical:** Security vulnerability, serious Shell stability risk,
  or severe data exposure
- **High:** Clear EGO rejection risk, resource leak, broken behavior,
  or substantial compatibility issue
- **Medium:** Significant reliability, performance, maintainability,
  or UX problem
- **Low:** Minor improvement with concrete, demonstrable value

### Requirement type

- **Mandatory:** Violates an explicit official MUST/MUST NOT rule
- **Recommended:** Conflicts with an official recommendation
- **Engineering:** General correctness or maintainability concern
- **Unverified:** Requires additional inspection or runtime testing

Do not label every suggestion as an official GNOME requirement.

## Evidence Requirements

Every confirmed finding must include:

1. Severity and requirement type
2. A precise file and line reference
3. Description of the problem
4. Why it matters in practice
5. Reference to the relevant rule, when applicable
6. A specific, minimal recommended fix

When reporting an official guideline violation, link directly
to the relevant documentation section if possible.

Do not invent line numbers, documentation rules, or API behavior.

Avoid duplicate findings for the same root cause.

If an issue depends on an assumption, explain that assumption.

## Output Format

Produce the review in the following structure.

### Summary

Provide:

- Overall assessment
- EGO submission readiness:
  Ready / Needs changes / Not ready / Cannot determine
- Number of findings by severity
- Review scope and limitations

### Findings

Group findings by severity, highest first.

For each finding use:

#### [Severity] Short actionable title

- **Type:** Mandatory / Recommended / Engineering / Unverified
- **Location:** `path/to/file.js:line`
- **Issue:** What is wrong
- **Impact:** Why it matters
- **Recommendation:** Specific minimal fix
- **Reference:** Official guideline or API documentation, if relevant

### Positive Observations

Briefly identify implementation decisions that already follow
GNOME guidelines particularly well.

Avoid generic praise.

### Recommended Actions

Provide a prioritized list of fixes:

1. EGO compliance blockers
2. Correctness and lifecycle problems
3. Performance and reliability improvements
4. Maintainability and UX improvements

### Verification

State:

- What files were inspected
- What checks were executed
- What checks were not executed
- What remains unverified

## Final Review Standards

Before completing the review:

- Ensure every finding is supported by evidence.
- Ensure official requirements are correctly classified.
- Ensure recommendations match supported Shell versions.
- Remove duplicate, speculative, and purely stylistic findings.
- Prefer the simplest correct solution.
- Make the result actionable without overwhelming the developer.

Do not modify the code during the review.

The goal is not to maximize the number of findings.
The goal is to identify genuine problems and help produce a
reliable, maintainable, GNOME-compliant extension.
