/**
 * Privacy scrubbing for the diagnostics export.
 * Default: user name, student/user id, email addresses, grade values and
 * discussion post bodies are redacted. Credentials are ALWAYS stripped.
 */

export interface RedactionOptions {
  /** Keep grade values (points earned, displayed grades, scores, feedback) */
  includeGrades: boolean;
  /** The signed-in user's display name (redacted everywhere it appears) */
  userName?: string | null;
  /** The signed-in user's Brightspace / student id (redacted everywhere) */
  userId?: string | null;
  /** Extra identifiers to redact (e.g. org-defined student number if known) */
  extraIdentifiers?: string[];
}

export const REDACTED = "[redacted]";
export const REDACTED_NAME = "[user-name]";
export const REDACTED_ID = "[student-id]";
export const REDACTED_EMAIL = "[email]";
export const REDACTED_GRADE = "[grade-redacted]";
export const REDACTED_BODY = "[post-body-redacted]";

/** Keys that may carry credentials — dropped entirely, regardless of options. */
const CREDENTIAL_KEY = /(cookie|token|password|passwd|secret|authorization|csrf|xsrf|session[_-]?id|api[_-]?key|bearer)/i;

/** Keys that carry grade values (redacted unless includeGrades). */
export const GRADE_KEYS = new Set([
  "pointsEarned",
  "gradeDisplay",
  "displayedGrade",
  "feedbackText",
  "gradeValue",
  "earned",
]);

/** Keys that carry discussion post bodies (always redacted). */
const POST_BODY_KEYS = new Set(["postBody", "discussionBody"]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STUDENT_ID_LABELLED_RE =
  /\b(student\s*(?:id|number|no\.?|#)|id\s*(?:number|no\.?))(\s*[:#-]?\s*)\d{6,10}\b/gi;
/** Credential-looking substrings inside free text (e.g. copied URLs) */
const INLINE_SECRET_RE =
  /\b(access_token|refresh_token|id_token|token|sessionid|session_id|d2lSessionVal|d2lSecureSessionVal|password)=([^&\s"']+)/gi;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface Scrubber {
  text(s: string): string;
  value(v: unknown): unknown;
}

export function makeScrubber(opts: RedactionOptions): Scrubber {
  const namePatterns: RegExp[] = [];
  const full = opts.userName?.trim();
  if (full && full.length >= 2) {
    namePatterns.push(new RegExp(escapeRe(full), "gi"));
    // "Last, First" ordering used by Brightspace in places
    const parts = full.split(/\s+/).filter((p) => p.length >= 3);
    if (parts.length >= 2) {
      namePatterns.push(
        new RegExp(`${escapeRe(parts[parts.length - 1])},\\s*${escapeRe(parts[0])}`, "gi"),
      );
    }
    // Individual name tokens — case-sensitive capitalised match to avoid eating common words
    for (const p of parts) {
      if (/^[A-Z]/.test(p)) namePatterns.push(new RegExp(`\\b${escapeRe(p)}\\b`, "g"));
    }
  }
  const idPatterns: RegExp[] = [];
  for (const id of [opts.userId, ...(opts.extraIdentifiers ?? [])]) {
    const t = id?.trim();
    if (t && t.length >= 3) idPatterns.push(new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`, "g"));
  }

  const text = (s: string): string => {
    let out = s.replace(INLINE_SECRET_RE, (_m, k: string) => `${k}=${REDACTED}`);
    out = out.replace(EMAIL_RE, REDACTED_EMAIL);
    for (const re of namePatterns) out = out.replace(re, REDACTED_NAME);
    for (const re of idPatterns) out = out.replace(re, REDACTED_ID);
    out = out.replace(STUDENT_ID_LABELLED_RE, (_m, label: string, sep: string) => `${label}${sep}${REDACTED_ID}`);
    return out;
  };

  const value = (v: unknown, key?: string): unknown => {
    if (key && POST_BODY_KEYS.has(key)) {
      return typeof v === "string" && v.length ? REDACTED_BODY : v;
    }
    if (key && !opts.includeGrades && GRADE_KEYS.has(key)) {
      return v == null || v === "" ? v : REDACTED_GRADE;
    }
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map((x) => value(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (CREDENTIAL_KEY.test(k)) continue;
        out[k] = value(val, k);
      }
      return out;
    }
    return v;
  };

  return { text, value: (v: unknown) => value(v) };
}

/** Convenience: deep-scrub any JSON-able value. */
export function redactDeep<T>(v: T, opts: RedactionOptions): T {
  return makeScrubber(opts).value(v) as T;
}
