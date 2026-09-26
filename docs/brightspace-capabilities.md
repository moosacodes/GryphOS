# Brightspace / CourseLink capabilities (sanitized)

Audit of authenticated LE/LP endpoints used by GryphOS for **local course reconstruction**.
Session-cookie only — no auth bypass. Status reflects student-session behaviour on
`courselink.uoguelph.ca` (403/404 common per course/tool). **No personal data** in this doc.

| Endpoint | Status | Shape (fields we use) | Usable? |
|---|---|---|---|
| `GET /d2l/api/versions/` | available | ProductCode, LatestVersion (lp/le) | yes |
| `GET /d2l/api/lp/{lp}/users/whoami` | available | Identifier, FirstName, LastName | yes |
| `GET /d2l/le/manageCourses/api/mycourses` | available | Courses[], Bookmark | yes |
| `GET /d2l/api/le/{le}/{ou}/dropbox/folders/` | available | Id, Name, DueDate, Availability, GradeItemId, IsHidden | yes |
| `GET .../dropbox/folders/{id}/submissions/mysubmissions/` | available | Submissions[].SubmissionDate | yes |
| `GET .../dropbox/folders/{id}/feedback/user/{userId}` | partial | Score, Feedback Text/Html, IsGraded | often 403/empty for students; logged |
| `GET .../quizzes/` | available | QuizId, Name, DueDate, EndDate, IsActive, GradeItemId | yes (paged) |
| `GET .../quizzes/{id}/attempts/` | partial | AttemptId, AttemptNumber, Score, Started, Completed | may 403; empty ≠ fabricated |
| `GET .../grades/` | available | Id, Name, MaxPoints, Weight, AssociatedTool, IsBonus | yes |
| `GET .../grades/values/myGradeValues/` | available | GradeObjectIdentifier, Points*, DisplayedGrade | yes |
| `GET .../grades/categories/` | available | Id, Name, Weight, NumberOfLowestToDrop | yes when tool enabled |
| `GET .../news/` | available | Id, Title, Body Text/Html, StartDate, IsHidden | yes |
| `GET .../calendar/events/` | partial | Title, Start/EndDateTime, Description | 403/404 → empty |
| `GET .../content/toc` + `/content/root/` | available | Modules/Topics Structure, Title, Url, DueDate, Description, LastModified | yes |
| `GET .../content/topics/{id}` | partial | topic detail | best-effort |
| `GET .../content/topics/{id}/file?stream=1` | partial | file bytes | often 403 even when UI works → `blocked` / metadata-only |
| `GET .../overview` + `/overview/attachment` | partial | Description, attachment | best-effort |
| `GET .../discussions/forums/` | available | ForumId, Name, Description, dates, IsHidden | yes |
| `GET .../discussions/forums/{f}/topics/` | available | TopicId, Name, DueDate, PinnedPostCount | yes |
| `GET .../discussions/forums/{f}/topics/{t}/posts/` | partial | PostId, Subject, Message, PostingUser*, DatePosted, LastEdited*, ThreadIsPinned, ParentPostId | **may 403**; coverage page says “forums discovered, posts unavailable” |
| `GET .../checklists/` | partial | ChecklistId, Name | often empty/404 |
| `GET /d2l/api/lp/{ver}/{ou}/groupcategories/` | partial | group categories | LP-scoped; may 404 with LE version — logged honestly |

## Shallow → deep (this release)

| Area | Before | After |
|---|---|---|
| Discussions | Forum **names** only | Forums → topics → **posts** (when API allows); author role; staff clarifications |
| Announcements | `deadlineChangeSignal` boolean | Structured facts (deadline/extension/cancel/location/exam/grade/resource/schedule) |
| Content | Titles + URLs | Hierarchy fields, description/body, download+hash+classify+library text |
| Grades | Objects + values on assessments | Categories map, unmatched grade items, feedback records |
| Quizzes | List + due | Attempt history when exposed; closed+no attempt → needs confirmation |
| Search | Title match | FTS index + **snippets** across content/library/discussions/policies |
| Coverage | None | Per-course diagnostic page with exact counts |

## DOM extraction

Only as a careful fallback when an API is missing **and** a CourseLink page is already open
in the authenticated tab. Not used to bypass auth. Prefer API + coverage honesty.

## Exploration log

Each sync appends sanitized `apiExplorationLog` entries: endpoint, HTTP status, usable flag,
note — no response bodies with personal content.
