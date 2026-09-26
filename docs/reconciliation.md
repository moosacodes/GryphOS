# Reconciliation

`src/reconcile` merges assessments that likely represent the same real-world item.

Matching is conservative (title tokens, type compatibility, numbering, date proximity).
False duplicates are worse than leaving two uncertain records separate.

Conflicts on due dates / weights are preserved and surfaced in the UI.
Authority is field-specific (e.g. CourseLink deadlines beat outline dates;
outline weights often beat missing CourseLink weights). Manual overrides win.
