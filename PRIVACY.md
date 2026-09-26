# gryphOS Privacy Policy

_Last updated: September 26, 2026_

gryphOS is a Chrome extension that organizes University of Guelph CourseLink
academic information locally on your device.

**Short version:** everything stays in your browser. gryphOS has no servers,
no accounts, no analytics, and no ads. Your data is never sent to the developer
or to third parties.

## What gryphOS reads

When CourseLink (`courselink.uoguelph.ca`) is open and you are signed in,
gryphOS uses your existing CourseLink session to read:

- Your name / CourseLink username (welcome UI only)
- Course list (codes, names, terms, dates)
- Assignments (dropboxes), quizzes, submission status
- Gradebook objects and released grade values
- Course news/announcements and calendar events when available
- Course outlines you explicitly import (PDF/text/HTML)

gryphOS does **not** collect CourseLink passwords, does not create a gryphOS
account, and does not access unrelated browsing history.

## Storage

Large structured academic data is stored in IndexedDB in your browser.
Preferences and sync status also use `chrome.storage.local` on your device.
Nothing is synced to a gryphOS backend (there is none).

## Network

The only network requests the extension makes for core features go from your
browser to CourseLink (and optionally University of Guelph public pages if
those adapters are used). Imported documents are parsed locally.

## Permissions

- `storage` — local preferences and sync metadata
- `tabs` — find/open a CourseLink tab to sync; open the full app
- Host access to `courselink.uoguelph.ca` — read academic data while signed in

## Deleting data

Remove the extension in `chrome://extensions`, or use **Reset local data** in
Settings. There is nothing hosted elsewhere to delete.

## Affiliation

Independent student project. Not made, endorsed, or supported by the University
of Guelph or D2L.
