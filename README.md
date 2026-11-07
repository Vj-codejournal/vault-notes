# Vault — notes, calendar & habits

An Obsidian-style note-taking app for your phone. It installs to your home screen, works offline, and keeps everything in plain Markdown files.

## Features

- **Local vault:** real folder structure, `.md` notes and images, stored on the device (IndexedDB). Export or import the whole vault as a `.zip` that Obsidian opens directly.
- **Obsidian syntax:** `[[wikilinks]]` (with autocomplete), `![[image.webp]]` embeds, `#tags`, `- [ ]` tasks you can tick in reading view, `==highlights==`, callouts (`> [!tip]`), frontmatter, backlinks. Renaming a note updates the links that point to it.
- **Images:** pick from the gallery or camera. They're downscaled and compressed, then saved in `attachments/`.
- **Full-text search:** searches every note's text, plus note and image names, as you type. Uses an inverted index with prefix, substring and typo-tolerant matching. Supports `"exact phrase"`, `-exclude`, `#tag` / `tag:`, `path:` and `file:` filters. Results show highlighted line snippets, and tapping one jumps to that line in the note.
- **Calendar:** month view with dots for events, to-dos and notes, plus a habit progress bar for each day. Each day has events (with times), checkable to-dos (with "move unfinished to tomorrow") and a daily note. All of it is stored in `Daily Notes/YYYY-MM-DD.md`, so it stays plain Markdown and search finds it.
- **Habits:** Today, Weekly and Overall views, like popular habit apps. A habit is either done/not done or an amount target (e.g. *Water 3.5 L in 0.5 L steps*). You can set a weekly schedule and reorder or archive habits. Each habit gets a **GitHub-contribution-style heatmap**, streaks and completion rate. You can tick any past day from the calendar or the heatmap.

## Install on Android

1. Open the GitHub Pages URL in Chrome (`https://vj-codejournal.github.io/vault-notes/`).
2. Open the ⋮ menu and choose **Add to Home screen** / **Install app**.

Your data lives on the device. Use **Settings → Export vault** now and then to keep a backup.

## Develop

No dependencies. `node build.mjs` creates `dist/` with one self-contained `index.html`, a service worker, the manifest and icons.

```
src/
  index.template.html   shell
  style.css
  js/01-util.js … 11-settings-main.js   (concatenated in order)
  vendor/marked.umd.js  Markdown parser (MIT)
  public/               manifest + icons
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`. In the repo settings, set **Pages → Source: GitHub Actions** once.
