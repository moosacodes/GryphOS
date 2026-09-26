# Data model

Primary entities live in `src/domain/types.ts`:

- `Course`, `Assessment`, `GradeRecord`, `GradeCategory`
- `Announcement`, `Resource`, `CoursePolicy`, `Meeting`, `Person`
- `AcademicDate`, `SourceRecord`, `Conflict`, `ImportedDocument`
- `AppData` — root document

Assessments carry field-level `fieldProvenance`, `conflictIds`, and
`manualOverrides`. Dates use `AcademicDateValue` with certainty
`exact | approximate | unknown | conflicting`.
