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
