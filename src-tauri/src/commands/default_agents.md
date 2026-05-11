# AGENTS.md — mdwriter vault

This folder is an **mdwriter vault**: a flat-ish collection of Markdown notes
the user edits with [mdwriter](https://github.com/Ryanb58/mdwriter). Keep edits
small and human-readable.

## Conventions

- One Markdown note per file. Use kebab-case filenames: `my-note.md`.
- The first H1 in the body is the preferred display title. Don't add a `title:`
  frontmatter field to new notes.
- YAML frontmatter sits at the top of a note between `---` delimiters.
- Most notes live at the vault root as flat `.md` files.

## Wikilinks

The user references other notes with double-bracket syntax:

- `[[filename]]` — link to `filename.md` at the vault root.
- `[[filename|display text]]` — link with custom display text.

When the user writes a prompt that contains `[[some-note]]`, treat that as a
request to read `some-note.md` from this directory and use its contents as
context. Wikilinks in frontmatter values represent relationships
(e.g. `Belongs to: "[[project-x]]"`).

## What you should do

- Create and edit notes using the H1-as-title and frontmatter conventions above.
- Resolve wikilinks the user includes in prompts by reading the matching file.
- Add or modify relationships in frontmatter without breaking existing
  wikilinks elsewhere.

## What you should avoid

- Don't add `title:` frontmatter to notes that already have (or will have) an H1.
- Don't silently overwrite an existing `AGENTS.md` if the user has customized it.
- Don't move notes between folders without confirmation — folder layout is part
  of the user's organization.
