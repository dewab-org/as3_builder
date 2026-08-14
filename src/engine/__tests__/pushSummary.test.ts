import { describe, expect, it } from "vitest";
import {
  describePush,
  summarizePush,
  type PushRowStatus,
} from "../../components/pushSummary";

const rows = (...statuses: PushRowStatus[]) =>
  statuses.map((status) => ({ checked: true, status }));

describe("push run summary", () => {
  it("counts what happened", () => {
    expect(summarizePush(rows("ok", "ok", "fail", "skipped"))).toEqual({
      applied: 2,
      failed: 1,
      skipped: 1,
    });
  });

  it("ignores rows that were never part of the run", () => {
    expect(summarizePush(rows("pending", "pending"))).toEqual({
      applied: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("reads as a sentence, mentioning only what applies", () => {
    expect(describePush({ applied: 4, failed: 0, skipped: 0 })).toBe(
      "4 applied"
    );
    expect(describePush({ applied: 2, failed: 1, skipped: 3 })).toBe(
      "2 applied · 1 failed · 3 skipped after the failure"
    );
  });
});
