/**
 * In-memory Sync trace: every Brightspace request Sync makes (path, status,
 * item count, bytes, error). Persisted into AppData.syncTrace at the end of a
 * sync so "Export diagnostics" can show what CourseLink actually returned.
 *
 * Privacy: only paths (query values stripped, user ids templated) are kept —
 * never headers, cookies, tokens or response bodies.
 */
import { COURSELINK_ORIGIN } from "@/domain/constants";

export type SyncTraceKind = "api" | "file" | "outline_candidate";

export interface SyncTraceEntry {
  at: string;
  kind: SyncTraceKind;
  /** Sanitized request path (no origin, no query values) or candidate title */
  endpoint: string;
  orgUnitId: number | null;
  status: number | "network_error" | null;
  ok: boolean;
  itemCount: number | null;
  bytes: number | null;
  ms: number | null;
  error: string | null;
  note: string | null;
}

export const SYNC_TRACE_LIMIT = 1500;

let buffer: SyncTraceEntry[] = [];

export function resetSyncTrace(): void {
  buffer = [];
}

export function takeSyncTrace(): SyncTraceEntry[] {
  const out = buffer.slice(-SYNC_TRACE_LIMIT);
  buffer = [];
  return out;
}

export function peekSyncTrace(): SyncTraceEntry[] {
  return buffer.slice();
}

export function recordSyncTrace(
  e: Omit<SyncTraceEntry, "at" | "orgUnitId" | "endpoint"> & {
    endpoint: string;
    orgUnitId?: number | null;
  },
): void {
  const endpoint = e.kind === "outline_candidate" ? e.endpoint.slice(0, 200) : sanitizeEndpoint(e.endpoint);
  buffer.push({
    ...e,
    endpoint,
    orgUnitId: e.orgUnitId ?? (e.kind === "outline_candidate" ? null : orgUnitFromPath(endpoint)),
    error: e.error ? e.error.slice(0, 300) : null,
    at: new Date().toISOString(),
  });
  if (buffer.length > SYNC_TRACE_LIMIT * 2) buffer = buffer.slice(-SYNC_TRACE_LIMIT);
}

/** Strip origin + query values; template user-specific path segments. */
export function sanitizeEndpoint(pathOrUrl: string): string {
  let p = pathOrUrl;
  if (p.startsWith(COURSELINK_ORIGIN)) p = p.slice(COURSELINK_ORIGIN.length);
  else if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = u.pathname + u.search;
    } catch {
      /* keep */
    }
  }
  const [path, query] = p.split("?", 2);
  let clean = path.replace(/\/(user|users)\/(\d+)(?=\/|$)/gi, "/$1/{userId}");
  if (query) {
    const keys = query
      .split("&")
      .map((kv) => kv.split("=")[0])
      .filter(Boolean);
    if (keys.length) clean += `?${keys.map((k) => `${k}=…`).join("&")}`;
  }
  return clean;
}

/** Brightspace org unit id from /d2l/api/{le|lp}/{ver}/{ou}/… style paths. */
export function orgUnitFromPath(path: string): number | null {
  const m = path.match(/\/d2l\/api\/(?:le|lp)\/[\d.]+\/(\d+)\//);
  if (m) return Number(m[1]);
  const m2 = path.match(/\/d2l\/le\/content\/(\d+)\//);
  return m2 ? Number(m2[1]) : null;
}

/** Group key: numeric ids/versions templated so repeated calls aggregate. */
export function endpointTemplate(path: string): string {
  return path
    .replace(/\/d2l\/api\/(le|lp)\/[\d.]+\//, "/d2l/api/$1/{v}/")
    .replace(/\/\d+(?=\/|$|\?)/g, "/{id}");
}

export function countItems(json: unknown): number | null {
  if (Array.isArray(json)) return json.length;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["Objects", "Items", "Modules", "Courses", "Structure"]) {
      if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
    }
    return 1;
  }
  return null;
}
