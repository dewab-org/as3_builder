import { useEffect, useState } from "react";
import { parse } from "jsonc-parser";
import {
  applicationGraphQuery,
  buildManifest,
  computeUpdates,
  renderNetboxApp,
  type AppManifest,
  type CreateObject,
  type DeleteObject,
  type ObjectChange,
} from "../engine";
import {
  ensureIpAddress,
  netboxGraphql,
  netboxRest,
  netboxSession,
} from "../netboxSession";

interface PushNetboxDialogProps {
  declarationText: string;
  /** Called with the freshly re-rendered declaration after a successful push. */
  onReloaded: (text: string) => void;
  onClose: () => void;
}

type RowStatus = "pending" | "applying" | "ok" | "fail";

type Row =
  | { kind: "update"; change: ObjectChange; checked: boolean; drifted: boolean; status: RowStatus; detail?: string }
  | { kind: "create"; create: CreateObject; checked: boolean; drifted: false; status: RowStatus; detail?: string }
  | { kind: "delete"; del: DeleteObject; checked: boolean; drifted: boolean; status: RowStatus; detail?: string };

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "—";
  const s = JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 45) + "…" : s;
}

function rowKey(row: Row): string {
  if (row.kind === "update") return `u-${row.change.entry.as3Key}`;
  if (row.kind === "create") return `c-${row.create.as3Key}`;
  return `d-${row.del.entry.as3Key}`;
}

function rowOpCount(row: Row): number {
  if (row.kind === "update")
    return row.change.changes.length + row.change.ops.length;
  return 1;
}

const PLUGIN_BASE = "/api/plugins/netbox-load-balancer";

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
        const changeSet = computeUpdates(declaration, m);
        setNotes(changeSet.notes);

        // Drift check for updates and deletes.
        setBusy("Checking for drift…");
        const drift = new Map<string, boolean>();
        const entries = [
          ...changeSet.updates.map((u) => u.entry),
          ...changeSet.deletes.map((d) => d.entry),
        ];
        await Promise.all(
          entries.map(async (entry) => {
            try {
              const obj = await netboxRest<{ last_updated?: string }>(
                `${PLUGIN_BASE}/${entry.endpoint}/${entry.id}/`
              );
              const a = Date.parse(entry.lastUpdated ?? "");
              const b = Date.parse(obj.last_updated ?? "");
              // NaN !== NaN → unparseable timestamps fail safe (drifted).
              drift.set(entry.as3Key, a !== b);
            } catch {
              drift.set(entry.as3Key, true);
            }
          })
        );

        const newRows: Row[] = [
          ...changeSet.creates.map(
            (create): Row => ({
              kind: "create",
              create,
              checked: true,
              drifted: false,
              status: "pending",
            })
          ),
          ...changeSet.updates.map((change): Row => {
            const drifted = drift.get(change.entry.as3Key) ?? false;
            return {
              kind: "update",
              change,
              drifted,
              checked:
                change.changes.length + change.ops.length > 0 && !drifted,
              status: "pending",
            };
          }),
          ...changeSet.deletes.map(
            (del): Row => ({
              kind: "delete",
              del,
              // Deletions are destructive — never pre-checked.
              checked: false,
              drifted: drift.get(del.entry.as3Key) ?? false,
              status: "pending",
            })
          ),
        ];
        setRows(newRows);
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applicable = rows.filter((r) => r.checked && rowOpCount(r) > 0);
  const totalOps = applicable.reduce((n, r) => n + rowOpCount(r), 0);
  const deleteCount = applicable.filter((r) => r.kind === "delete").length;

  async function ensureCertificate(name: string): Promise<number> {
    const found = await netboxRest<{ results: { id: number }[] }>(
      `${PLUGIN_BASE}/certificates/?name=${encodeURIComponent(name)}`
    );
    if (found.results.length > 0) return found.results[0].id;
    const created = await netboxRest<{ id: number }>(
      `${PLUGIN_BASE}/certificates/`,
      { method: "POST", body: { name, distinguished_name: name } }
    );
    return created.id;
  }

  async function applyCreate(
    create: CreateObject,
    keyToId: Map<string, number>,
    appId: number
  ): Promise<void> {
    const body: Record<string, unknown> = { ...create.fields };

    if (create.certificateNames) {
      const ids: number[] = [];
      for (const name of create.certificateNames)
        ids.push(await ensureCertificate(name));
      body.certificates = ids;
    }
    for (const ref of create.refs) {
      const id = keyToId.get(ref.targetKey);
      if (id === undefined)
        throw new Error(
          `reference "${ref.targetKey}" (${ref.field}) does not resolve to a NetBox object`
        );
      body[ref.field] = id;
    }
    if (create.monitorRefs && create.monitorRefs.length > 0) {
      const ids: number[] = [];
      for (const key of create.monitorRefs) {
        const id = keyToId.get(key);
        if (id === undefined)
          throw new Error(`monitor reference "${key}" does not resolve`);
        ids.push(id);
      }
      body.monitors = ids;
    }
    if (create.endpoint === "virtual-servers") {
      body.applications = [appId];
      if (create.vipAddresses && create.vipAddresses.length > 0) {
        const ids: number[] = [];
        for (const address of create.vipAddresses)
          ids.push(await ensureIpAddress(address));
        body.virtual_addresses = ids;
      }
    }

    const created = await netboxRest<{ id: number }>(
      `${PLUGIN_BASE}/${create.endpoint}/`,
      { method: "POST", body }
    );
    keyToId.set(create.as3Key, created.id);

    for (const member of create.members ?? []) {
      const nodeId = await ensureIpAddress(member.addressWithMask);
      const memberBody: Record<string, unknown> = {
        pool: created.id,
        node: nodeId,
        service_port: member.servicePort,
      };
      if (!member.enabled) memberBody.enabled = false;
      if (member.ratio) memberBody.ratio = member.ratio;
      if (member.priorityGroup) memberBody.priority_group = member.priorityGroup;
      await netboxRest(`${PLUGIN_BASE}/pool-members/`, {
        method: "POST",
        body: memberBody,
      });
    }
  }

  async function applyUpdate(
    change: ObjectChange,
    keyToId: Map<string, number>
  ): Promise<void> {
    const { entry } = change;
    const base = `${PLUGIN_BASE}/${entry.endpoint}`;
    if (change.changes.length > 0) {
      const body: Record<string, unknown> = {};
      for (const c of change.changes) body[c.field] = c.to;
      await netboxRest(`${base}/${entry.id}/`, { method: "PATCH", body });
    }
    for (const op of change.ops) {
      switch (op.op) {
        case "member-create": {
          const nodeId = await ensureIpAddress(op.addressWithMask);
          await netboxRest(`${PLUGIN_BASE}/pool-members/`, {
            method: "POST",
            body: { pool: entry.id, node: nodeId, ...op.body },
          });
          break;
        }
        case "member-update":
          await netboxRest(`${PLUGIN_BASE}/pool-members/${op.memberId}/`, {
            method: "PATCH",
            body: op.body,
          });
          break;
        case "member-delete":
          await netboxRest(`${PLUGIN_BASE}/pool-members/${op.memberId}/`, {
            method: "DELETE",
          });
          break;
        case "vs-addresses": {
          const ids: number[] = [];
          for (const address of op.addresses)
            ids.push(await ensureIpAddress(address));
          await netboxRest(`${base}/${entry.id}/`, {
            method: "PATCH",
            body: { virtual_addresses: ids },
          });
          break;
        }
        case "pool-monitors": {
          const ids: number[] = [];
          for (const key of op.keys) {
            const id = keyToId.get(key);
            if (id === undefined)
              throw new Error(`monitor reference "${key}" does not resolve`);
            ids.push(id);
          }
          await netboxRest(`${base}/${entry.id}/`, {
            method: "PATCH",
            body: { monitors: ids },
          });
          break;
        }
        case "vs-ref": {
          let id: number | null = null;
          if (op.targetKey !== null) {
            const resolved = keyToId.get(op.targetKey);
            if (resolved === undefined)
              throw new Error(
                `reference "${op.targetKey}" does not resolve to a NetBox object`
              );
            id = resolved;
          }
          await netboxRest(`${base}/${entry.id}/`, {
            method: "PATCH",
            body: { [op.field]: id },
          });
          break;
        }
      }
    }
  }

  async function apply() {
    if (!manifest) return;
    setConfirming(false);
    setBusy("Applying…");
    let failed = false;

    const keyToId = new Map<string, number>();
    for (const entry of manifest.entries) keyToId.set(entry.as3Key, entry.id);

    // Row order is already creates → updates → deletes (FK-safe).
    for (const row of rows) {
      if (!row.checked || rowOpCount(row) === 0) continue;
      if (failed) break;
      setRows((prev) =>
        prev.map((r) => (r === row ? { ...r, status: "applying" } : r))
      );
      try {
        if (row.kind === "create")
          await applyCreate(row.create, keyToId, manifest.appId);
        else if (row.kind === "update") await applyUpdate(row.change, keyToId);
        else
          await netboxRest(
            `${PLUGIN_BASE}/${row.del.entry.endpoint}/${row.del.entry.id}/`,
            { method: "DELETE" }
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

  function renderRow(row: Row, i: number) {
    const head =
      row.kind === "update"
        ? {
            kindLabel: "UPDATE",
            name: row.change.entry.as3Key,
            sub: `${row.change.entry.className} #${row.change.entry.id}`,
          }
        : row.kind === "create"
          ? {
              kindLabel: "CREATE",
              name: row.create.as3Key,
              sub: row.create.className,
            }
          : {
              kindLabel: "DELETE",
              name: row.del.entry.as3Key,
              sub: `${row.del.entry.className} #${row.del.entry.id}`,
            };
    return (
      <div
        key={rowKey(row)}
        className={`push-row${row.drifted ? " drifted" : ""}`}
      >
        <label className="push-row-head">
          <input
            type="checkbox"
            checked={row.checked}
            disabled={rowOpCount(row) === 0 || busy !== null}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, j) =>
                  j === i ? { ...r, checked: e.target.checked } : r
                )
              )
            }
          />
          <span className={`push-kind ${row.kind}`}>{head.kindLabel}</span>
          <span className="push-name">
            {head.name}
            <span className="push-class">{head.sub}</span>
          </span>
          {row.drifted && (
            <span className="push-drift">changed in NetBox since load</span>
          )}
          {row.status === "ok" && <span className="push-ok">✓</span>}
          {row.status === "applying" && <span>◐</span>}
          {row.status === "fail" && <span className="push-fail">✗</span>}
        </label>
        {row.kind === "update" && (
          <>
            {row.change.changes.map((c) => (
              <div key={c.field} className="push-field">
                <code>{c.field}</code>
                <span className="push-from">{fmt(c.from)}</span>
                <span className="push-arrow">→</span>
                <span className="push-to">{fmt(c.to)}</span>
              </div>
            ))}
            {row.change.ops.map((op, j) => (
              <div key={`op-${j}`} className="push-field">
                <span
                  className={op.op === "member-delete" ? "push-from" : "push-to"}
                >
                  {op.label}
                </span>
              </div>
            ))}
            {rowOpCount(row) === 0 && (
              <div className="push-field push-noop">
                only out-of-scope edits — nothing pushable
              </div>
            )}
          </>
        )}
        {row.kind === "create" && (
          <div className="push-field">
            <span className="push-to">{row.create.label}</span>
            {row.create.vipAddresses && row.create.vipAddresses.length > 0 && (
              <span className="push-class">
                VIPs: {row.create.vipAddresses.join(", ")}
              </span>
            )}
          </div>
        )}
        {row.kind === "delete" && (
          <div className="push-field">
            <span className="push-from">{row.del.label}</span>
          </div>
        )}
        {row.detail && <div className="push-field push-fail">{row.detail}</div>}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Push changes to NetBox</h2>
        <p className="ctx-hint">
          Writes this declaration's edits back to the NetBox objects it was
          loaded from: field updates, pool membership, virtual addresses, and
          object creation/deletion. IPs and certificate stubs are created as
          needed. Deletions are never pre-selected.
        </p>

        {error && <div className="modal-error">{error}</div>}

        {!error && rows.length === 0 && !busy && (
          <p className="ctx-hint">
            No pushable changes — the declaration matches NetBox.
          </p>
        )}

        {rows.length > 0 && (
          <div className="push-list">{rows.map((row, i) => renderRow(row, i))}</div>
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
            <strong>Write to NetBox?</strong> {totalOps} change
            {totalOps === 1 ? "" : "s"} across {applicable.length} object
            {applicable.length === 1 ? "" : "s"} on{" "}
            <code>{netboxSession.url}</code>
            {deleteCount > 0 && (
              <>
                {" "}
                — including <strong>{deleteCount} deletion{deleteCount === 1 ? "" : "s"}</strong>
              </>
            )}
            .
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
              {busy ?? `Apply ${totalOps} change${totalOps === 1 ? "" : "s"}…`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
