# JARVIS product shell (v2)

## Intent

Rebuild the *product surface* as a university J.A.R.V.I.S — not another planner dashboard.

- Cinematic **System Brief** on open
- **Command surface** (Ctrl+K) as primary navigation
- **Living My Day** timeline as the operational heart
- Sync / outline / document engines remain **backend only**

## Map

| Surface | Code |
|--------|------|
| Brief copy | `src/engines/brief.ts` |
| My Day model | `src/engines/myday.ts` |
| Shell chrome | `src/ui/components/Shell.tsx` |
| Command surface | `src/ui/components/CommandPalette.tsx` |
| Home UX | `src/ui/pages/TodayPage.tsx` |
| Styles | `src/ui/styles/jarvis.css`, `tokens.css` |

## Non-goals

- No chatbot / LLM
- No inventing academic facts for the brief
- No returning to left-nav CRUD as the home experience

## Planning autonomy (v2.2.0)

All in `src/engines/planningKnowledge.ts` (no new engine):

- `explainAssessment` - WHY evidence: weight/blueprint, submission, due, relative deadline, best-N/drop, section timing, linked materials, dependencies/clarifications, grade rules.
- `explainIgnoreImpact` - grade risk, schedule shift, next focus if skipped.
- `detectStaleModelGaps` / `evaluatePlanningGate` - blueprint vs live sync (missing assessments, promised-count shortfall, weights, dates, materials, quality, section). Blocking gaps set `requestRecheck` -> TodayPage queues `pendingSync` (throttled 10 min).
- `buildAutonomousRecoveryPlan` - after misses/overdue/plan-shifting changes, rebuild around still-actionable highest-impact work; defers absorbable best-N quizzes.
- `replanTriggers` / `buildPlanningAutonomy` - change events (deadline, weight, grade, announcement, doc version, rule, section, cancellation) drive re-plan notes.

