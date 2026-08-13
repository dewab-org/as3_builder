import { useEffect, useState } from "react";
import { parse } from "jsonc-parser";
import {
  applicationGraphQuery,
  buildManifest,
  computeUpdates,
  renderNetboxApp,
  type AppManifest,
  type ObjectChange,
} from "../engine";
import { netboxGraphql, netboxRest, netboxSession } from "../netboxSession";

interface PushNetboxDialogProps {
  declarationText: string;
  /** Called with the freshly re-rendered declaration after a successful push. */
  onReloaded: (text: string) => void;
  onClose: () => void;
}

type RowStatus = "pending" | "applying" | "ok" | "fail";

interface Row {
  change: ObjectChange;
  checked: boolean;
  drifted: boolean;
  status: RowStatus;
  detail?: string;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "—";
  const s = JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 45) + "…" : s;
}

export default function PushNetboxDialog({
  declarationText,
  onReloaded,
  onClose,
}: PushNetboxDialogProps) {
  const [manifest, setManifest] = useState<AppManifest | undefined>();
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  // Compute the change set + drift on open.
  useEffect(() => {
    void (async () => {
      setBusy("Computing changes…");
      try {
        const declaration = parse(declarationText, [], {
          allowTrailingComma: true,
        }) as Record<string, unknown>;
        if (!declaration || typeof declaration !== "object")
          throw new Error("Editor content is not valid JSON");
        const m = netboxSession.manifests.get(String(declaration.id ?? ""));
        if (!m)
          throw new Error(
            "No NetBox provenance for this declaration. Load an application via “Load from NetBox…” first (write-back only works in the session that loaded it)."
          );
        setManifest(m);
        const { updates, notes } = computeUpdates(declaration, m);
        setNotes(notes);

        // Drift check: anything modified in NetBox since we loaded it?
        setBusy("Checking for drift…");
        const drift = new Map<string, boolean>();
        await Promise.all(
          updates.map(async (u) => {
            try {
              const obj = await netboxRest<{ last_updated?: string }>(
                `/api/plugins/netbox-load-balancer/${u.entry.endpoint}/${u.entry.id}/`
              );
              // GraphQL renders timestamps as +00:00, REST as Z — compare as
              // instants, not strings.
              const a = Date.parse(u.entry.lastUpdated ?? "");
              const b = Date.parse(obj.last_updated ?? "");
              // NaN !== NaN, so unparseable timestamps fail safe (drifted).
              drift.set(u.entry.as3Key, a !== b);
            } catch {
              drift.set(u.entry.as3Key, true); // unreachable/deleted → treat as drifted
            }
          })
        );
        setRows(
          updates.map((change) => {
            const drifted = drift.get(change.entry.as3Key) ?? false;
            return {
              change,
              drifted,
              checked: change.changes.length > 0 && !drifted,
              status: "pending" as RowStatus,
            };
          })
        );
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applicable = rows.filter((r) => r.checked && r.change.changes.length > 0);

  async function apply() {
    if (!manifest) return;
    setConfirming(false);
    setBusy("Applying…");
    let failed = false;
    for (const row of rows) {
      if (!row.checked || row.change.changes.length === 0) continue;
      if (failed) break;
      setRows((prev) =>
        prev.map((r) => (r === row ? { ...r, status: "applying" } : r))
      );
      const body: Record<string, unknown> = {};
      for (const c of row.change.changes) body[c.field] = c.to;
      try {
        await netboxRest(
          `/api/plugins/netbox-load-balancer/${row.change.entry.endpoint}/${row.change.entry.id}/`,
          { method: "PATCH", body }
        );
        setRows((prev) =>
          prev.map((r) => (r === row ? { ...r, status: "ok" } : r))
        );
      } catch (err) {
        failed = true;
        setRows((prev) =>
          prev.map((r) =>
            r === row
              ? {
                  ...r,
                  status: "fail",
                  detail: String(err instanceof Error ? err.message : err),
                }
              : r
          )
        );
      }
    }

    if (!failed) {
      // Re-fetch, re-render, refresh manifest — the editor then shows the
      // round-tripped truth and modified-highlighting clears.
      try {
        setBusy("Reloading from NetBox…");
        const data = await netboxGraphql<{
          application_list: Record<string, unknown>[];
        }>(applicationGraphQuery(manifest.appId));
        const app = data.application_list[0];
        if (app) {
          const { declaration } = renderNetboxApp(app);
          const fresh = buildManifest(app, declaration);
          netboxSession.manifests.set(fresh.declarationId, fresh);
          onReloaded(JSON.stringify(declaration, null, 2) + "\n");
        }
        setDone(true);
      } catch (err) {
        setError(
          `Changes applied, but reloading failed: ${String(
            err instanceof Error ? err.message : err
          )}`
        );
      }
    }
    setBusy(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Push changes to NetBox</h2>
        <p className="ctx-hint">
          Field-level updates to the NetBox objects this declaration was loaded
          from. Creations, deletions, and membership changes are not pushed yet
          (phases W2/W3).
        </p>

        {error && <div className="modal-error">{error}</div>}

        {!error && rows.length === 0 && !busy && (
          <p className="ctx-hint">
            No pushable field changes — the declaration matches NetBox.
          </p>
        )}

        {rows.length > 0 && (
          <div className="push-list">
            {rows.map((row, i) => (
              <div
                key={row.change.entry.as3Key}
                className={`push-row${row.drifted ? " drifted" : ""}`}
              >
                <label className="push-row-head">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    disabled={row.change.changes.length === 0 || busy !== null}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, j) =>
                          j === i ? { ...r, checked: e.target.checked } : r
                        )
                      )
                    }
                  />
                  <span className="push-kind">UPDATE</span>
                  <span className="push-name">
                    {row.change.entry.as3Key}
                    <span className="push-class">
                      {row.change.entry.className} #{row.change.entry.id}
                    </span>
                  </span>
                  {row.drifted && (
                    <span className="push-drift">changed in NetBox since load</span>
                  )}
                  {row.status === "ok" && <span className="push-ok">✓</span>}
                  {row.status === "applying" && <span>◐</span>}
                  {row.status === "fail" && <span className="push-fail">✗</span>}
                </label>
                {row.change.changes.map((c) => (
                  <div key={c.field} className="push-field">
                    <code>{c.field}</code>
                    <span className="push-from">{fmt(c.from)}</span>
                    <span className="push-arrow">→</span>
                    <span className="push-to">{fmt(c.to)}</span>
                  </div>
                ))}
                {row.change.changes.length === 0 && (
                  <div className="push-field push-noop">
                    only out-of-scope edits — nothing pushable
                  </div>
                )}
                {row.detail && (
                  <div className="push-field push-fail">{row.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {notes.length > 0 && (
          <div className="modal-warnings">
            <strong>Not pushed:</strong>
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {confirming && manifest && (
          <div className="modal-confirm">
            <strong>Write to NetBox?</strong> This will PATCH{" "}
            {applicable.length} object{applicable.length === 1 ? "" : "s"} on{" "}
            <code>{netboxSession.url}</code>.
            <div className="modal-confirm-actions">
              <button onClick={() => setConfirming(false)}>Cancel</button>
              <button className="danger" onClick={apply}>
                Yes, push
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{done ? "Done" : "Close"}</button>
          {!done && (
            <button
              className="primary"
              disabled={busy !== null || applicable.length === 0}
              onClick={() => setConfirming(true)}
            >
              {busy ?? `Apply ${applicable.length} change${applicable.length === 1 ? "" : "s"}…`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
