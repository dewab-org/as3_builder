/** Outcome of a push run, for the line shown when it finishes. */
export interface PushSummary {
  applied: number;
  failed: number;
  /** Checked rows the run never reached, because a failure stopped it. */
  skipped: number;
  /** Creates that succeeded but were deleted again because a later step
   * failed: creation is all-or-nothing. */
  rolledBack: number;
}

export type PushRowStatus =
  | "pending"
  | "applying"
  | "ok"
  | "fail"
  | "skipped"
  | "rolled-back";

export function summarizePush(
  rows: { checked: boolean; status: PushRowStatus }[]
): PushSummary {
  const summary = { applied: 0, failed: 0, skipped: 0, rolledBack: 0 };
  for (const row of rows) {
    if (row.status === "ok") summary.applied++;
    else if (row.status === "fail") summary.failed++;
    else if (row.status === "skipped") summary.skipped++;
    else if (row.status === "rolled-back") summary.rolledBack++;
  }
  return summary;
}

/**
 * A sentence rather than three counters: after a partial failure the useful
 * question is "what happened to the rest?", and "2 skipped" answers it where
 * rows silently left at "pending" did not.
 */
export function describePush(summary: PushSummary): string {
  const parts = [
    `${summary.applied} applied`,
    ...(summary.failed > 0 ? [`${summary.failed} failed`] : []),
    ...(summary.skipped > 0
      ? [`${summary.skipped} skipped after the failure`]
      : []),
    ...(summary.rolledBack > 0
      ? [`${summary.rolledBack} rolled back — nothing new was left behind`]
      : []),
  ];
  return parts.join(" · ");
}
