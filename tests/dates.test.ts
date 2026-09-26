import { describe, expect, it } from "vitest";
import { approximateDate, exactDate, parseCourseLinkDate, torontoDayKey, unknownDate } from "@/domain/dates";

describe("dates", () => {
  it("parses ISO timestamps", () => {
    const d = parseCourseLinkDate("2026-10-16T03:59:00.000Z");
    expect(d).not.toBeNull();
  });

  it("preserves certainty states", () => {
    expect(exactDate("2026-10-16T03:59:00.000Z").certainty).toBe("exact");
    expect(approximateDate("Week 6").certainty).toBe("approximate");
    expect(unknownDate().certainty).toBe("unknown");
  });

  it("toronto day key is stable", () => {
    // Afternoon UTC on Oct 16 is still Oct 16 in Toronto (EDT UTC-4)
    expect(torontoDayKey("2026-10-16T18:00:00.000Z")).toBe("2026-10-16");
  });
});
