import { useEffect, useState } from "react";
import { parse } from "jsonc-parser";
import {
  applicationGraphQuery,
  buildManifest,
  computeUpdates,
  findApplicationKey,
  newAppManifest,
  renderNetboxApp,
  slugify,
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

import {
  describePush,
  summarizePush,
  type PushRowStatus,
} from "./pushSummary";

type RowStatus = PushRowStatus;

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
  const [declaration, setDeclaration] = useState<Record<string, unknown>>();
  /** Metadata survey for a declaration with no NetBox provenance: the fields
   * a net-new Application needs that AS3 does not carry. */
  const [survey, setSurvey] = useState<{
    appKey: string;
    name: string;
    description: string;
    snowSysId: string;
    clusterId: number | null;
    clusters: { id: number; name: string }[];
  }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  // Set when a run finishes, so the outcome is stated rather than inferred
  // from a column of ticks.
  const [summary, setSummary] = useState<ReturnType<typeof summarizePush>>();

  // Compute the change set + drift for a (declaration, manifest) pair.
  async function computeRows(
    decl: Record<string, unknown>,
    m: AppManifest
  ): Promise<void> {
    setManifest(m);
    const changeSet = computeUpdates(decl, m);
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
  }

  // On open: parse the editor, find provenance, and either diff against it or
  // open the net-new application survey.
  useEffect(() => {
    void (async () => {
      setBusy("Computing changes…");
      setSummary(undefined);
      try {
        const decl = parse(declarationText, [], {
          allowTrailingComma: true,
        }) as Record<string, unknown>;
        if (!decl || typeof decl !== "object")
          throw new Error("Editor content is not valid JSON");
        setDeclaration(decl);
        const m = netboxSession.manifests.get(String(decl.id ?? ""));
        if (m) {
          await computeRows(decl, m);
          return;
        }
        // No provenance: this declaration can become a NET-NEW application.
        const appKey = findApplicationKey(decl);
        if (!appKey)
          throw new Error(
            "No NetBox provenance and no Application object in the declaration — nothing to push."
          );
        const appObj = decl[appKey] as Record<string, unknown>;
        if (
          !netboxSession.authHeader &&
          !netboxSession.token.trim() &&
          !netboxSession.username
        )
          throw new Error(
            "Not connected to NetBox. Use “Connect…” in the NetBox toolbar group, then push again to create this declaration as a new application."
          );
        setBusy("Loading clusters…");
        // Virtual servers live on BIG-IP HA clusters; other cluster types
        // (vSphere, Kubernetes) are not placement targets. Estates without
        // the bigip-ha type fall back to the full list rather than a dead
        // dropdown.
        let clusters = await netboxRest<{
          results: { id: number; name: string }[];
        }>(`/api/virtualization/clusters/?type=bigip-ha&limit=500`);
        if (clusters.results.length === 0)
          clusters = await netboxRest<{
            results: { id: number; name: string }[];
          }>(`/api/virtualization/clusters/?limit=500`);
        setSurvey({
          appKey,
          name: appKey,
          description: typeof appObj.label === "string" ? appObj.label : "",
          snowSysId: "",
          clusterId: null,
          clusters: clusters.results,
        });
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Turn the survey into a change list. Nothing is written yet: the
  // application itself is created as the first step of Apply, inside the
  // same all-or-nothing run as everything else.
  const [pendingApp, setPendingApp] = useState<Record<string, unknown> | null>(
    null
  );
  async function continueFromSurvey() {
    if (!survey || !declaration || survey.clusterId === null) return;
    setError(undefined);
    const body: Record<string, unknown> = {
      name: survey.name.trim(),
      slug: slugify(survey.name),
      description: survey.description,
    };
    if (survey.snowSysId.trim()) body.snow_sys_id = survey.snowSysId.trim();
    // id 0 until Apply creates the record.
    const m = newAppManifest(declaration, survey.appKey, { id: 0 }, survey.clusterId);
    setPendingApp(body);
    setSurvey(undefined);
    setBusy("Computing changes…");
    try {
      await computeRows(declaration, m);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  const applicable = rows.filter((r) => r.checked && rowOpCount(r) > 0);
  const totalOps =
    applicable.reduce((n, r) => n + rowOpCount(r), 0) + (pendingApp ? 1 : 0);
  const deleteCount = applicable.filter((r) => r.kind === "delete").length;

  // NetBox holds certificate metadata only — the material lives in the
  // certificate estate. A missing record is created as a placeholder so the
  // profile can be built in one pass, and reported so it gets reconciled.
  async function ensureCertificate(
    name: string
  ): Promise<{ id: number; placeholder: boolean }> {
    const found = await netboxRest<{ results: { id: number }[] }>(
      `${PLUGIN_BASE}/certificates/?name=${encodeURIComponent(name)}`
    );
    if (found.results.length > 0)
      return { id: found.results[0].id, placeholder: false };
    const created = await netboxRest<{ id: number }>(
      `${PLUGIN_BASE}/certificates/`,
      { method: "POST", body: { name, distinguished_name: name } }
    );
    return { id: created.id, placeholder: true };
  }

  /** One step to reverse on rollback: DELETE what the run created (the
   * default), PATCH an updated object's fields back to their prior values,
   * or POST a deleted pool member back. */
  interface UndoEntry {
    /** Proxy path, e.g. "/api/plugins/netbox-load-balancer/backend-pools/12/". */
    path: string;
    label: string;
    method?: "DELETE" | "PATCH" | "POST";
    body?: Record<string, unknown>;
  }

  /** A read-back value in the shape NetBox accepts on write: nested objects
   * become their id, lists of them a list of ids. */
  function writable(v: unknown): unknown {
    if (Array.isArray(v))
      return v.map((x) =>
        x && typeof x === "object" && "id" in x ? (x as { id: unknown }).id : x
      );
    if (v && typeof v === "object" && "id" in v) return (v as { id: unknown }).id;
    return v;
  }

  /** PATCH, after recording the fields' current values so a rollback can
   * put them back. */
  async function patchTracked(
    path: string,
    body: Record<string, unknown>,
    undo: UndoEntry[]
  ): Promise<void> {
    const before = await netboxRest<Record<string, unknown>>(path);
    const restore: Record<string, unknown> = {};
    for (const field of Object.keys(body)) restore[field] = writable(before[field]);
    await netboxRest(path, { method: "PATCH", body });
    undo.push({ path, label: `restore ${path}`, method: "PATCH", body: restore });
  }

  /** Returns warnings worth surfacing on the row (placeholder certificates). */
  async function applyCreate(
    create: CreateObject,
    keyToId: Map<string, number>,
    appId: number,
    undo: UndoEntry[]
  ): Promise<string[]> {
    const body: Record<string, unknown> = { ...create.fields };
    const warnings: string[] = [];

    if (create.certificateNames) {
      const ids: number[] = [];
      for (const name of create.certificateNames) {
        const cert = await ensureCertificate(name);
        ids.push(cert.id);
        if (cert.placeholder) {
          undo.push({
            path: `${PLUGIN_BASE}/certificates/${cert.id}/`,
            label: `placeholder certificate "${name}"`,
          });
          warnings.push(
            `placeholder certificate "${name}" created in NetBox — it is a pointer only, so reconcile it with the certificate estate`
          );
        }
      }
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
    // M2M links by AS3 key: this changeset's own creates first, then by
    // NetBox name — a service may point at estate objects that were never
    // part of this declaration.
    async function resolveLinks(
      endpoint: "policies" | "protocol-profiles",
      keys: string[]
    ): Promise<number[]> {
      const ids: number[] = [];
      for (const key of keys) {
        const known = keyToId.get(key);
        if (known !== undefined) {
          ids.push(known);
          continue;
        }
        const found = await netboxRest<{ results: { id: number }[] }>(
          `${PLUGIN_BASE}/${endpoint}/?name=${encodeURIComponent(key)}`
        );
        if (found.results.length === 0)
          throw new Error(
            `"${key}" does not exist in NetBox — create it there first`
          );
        ids.push(found.results[0].id);
      }
      return ids;
    }

    if (create.endpoint === "virtual-servers") {
      // Required single-application FK since plugin 0.9.0 (G2); the required
      // cluster is already in create.fields (stamped by computeUpdates).
      body.application = appId;
      if (create.policyKeys && create.policyKeys.length > 0)
        body.policies = await resolveLinks("policies", create.policyKeys);
      if (create.protocolProfileKeys && create.protocolProfileKeys.length > 0)
        body.protocol_profiles = await resolveLinks(
          "protocol-profiles",
          create.protocolProfileKeys
        );
      if (create.vipAddresses && create.vipAddresses.length > 0) {
        const ids: number[] = [];
        for (const address of create.vipAddresses) {
          const ip = await ensureIpAddress(address);
          if (ip.created)
            undo.push({
              path: `/api/ipam/ip-addresses/${ip.id}/`,
              label: `IP address ${address}`,
            });
          ids.push(ip.id);
        }
        body.virtual_addresses = ids;
      }
    }

    const created = await netboxRest<{ id: number }>(
      `${PLUGIN_BASE}/${create.endpoint}/`,
      { method: "POST", body }
    );
    keyToId.set(create.as3Key, created.id);
    undo.push({
      path: `${PLUGIN_BASE}/${create.endpoint}/${created.id}/`,
      label: `${create.className} "${create.as3Key}"`,
    });

    for (const member of create.members ?? []) {
      const ip = await ensureIpAddress(member.addressWithMask);
      if (ip.created)
        undo.push({
          path: `/api/ipam/ip-addresses/${ip.id}/`,
          label: `IP address ${member.addressWithMask}`,
        });
      const memberBody: Record<string, unknown> = {
        pool: created.id,
        node: ip.id,
        service_port: member.servicePort,
      };
      if (!member.enabled) memberBody.enabled = false;
      if (member.ratio) memberBody.ratio = member.ratio;
      if (member.priorityGroup) memberBody.priority_group = member.priorityGroup;
      const m = await netboxRest<{ id: number }>(`${PLUGIN_BASE}/pool-members/`, {
        method: "POST",
        body: memberBody,
      });
      undo.push({
        path: `${PLUGIN_BASE}/pool-members/${m.id}/`,
        label: `member ${member.address}:${member.servicePort}`,
      });
    }
    return warnings;
  }

  async function applyUpdate(
    change: ObjectChange,
    keyToId: Map<string, number>,
    undo: UndoEntry[]
  ): Promise<void> {
    const { entry } = change;
    const base = `${PLUGIN_BASE}/${entry.endpoint}`;
    if (change.changes.length > 0) {
      const body: Record<string, unknown> = {};
      for (const c of change.changes) body[c.field] = c.to;
      await patchTracked(`${base}/${entry.id}/`, body, undo);
    }
    for (const op of change.ops) {
      switch (op.op) {
        case "member-create": {
          const ip = await ensureIpAddress(op.addressWithMask);
          if (ip.created)
            undo.push({
              path: `/api/ipam/ip-addresses/${ip.id}/`,
              label: `IP address ${op.addressWithMask}`,
            });
          const m = await netboxRest<{ id: number }>(
            `${PLUGIN_BASE}/pool-members/`,
            {
              method: "POST",
              body: { pool: entry.id, node: ip.id, ...op.body },
            }
          );
          undo.push({
            path: `${PLUGIN_BASE}/pool-members/${m.id}/`,
            label: op.label,
          });
          break;
        }
        case "member-update":
          await patchTracked(
            `${PLUGIN_BASE}/pool-members/${op.memberId}/`,
            op.body,
            undo
          );
          break;
        case "member-delete": {
          // Read it first so a rollback can recreate it.
          const path = `${PLUGIN_BASE}/pool-members/${op.memberId}/`;
          const before = await netboxRest<Record<string, unknown>>(path);
          const recreate: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(before)) {
            if (["id", "url", "display", "display_url", "created", "last_updated"].includes(k))
              continue;
            recreate[k] = writable(v);
          }
          await netboxRest(path, { method: "DELETE" });
          undo.push({
            path: `${PLUGIN_BASE}/pool-members/`,
            label: `restore ${op.label}`,
            method: "POST",
            body: recreate,
          });
          break;
        }
        case "vs-addresses": {
          const ids: number[] = [];
          for (const address of op.addresses) {
            const ip = await ensureIpAddress(address);
            if (ip.created)
              undo.push({
                path: `/api/ipam/ip-addresses/${ip.id}/`,
                label: `IP address ${address}`,
              });
            ids.push(ip.id);
          }
          await patchTracked(`${base}/${entry.id}/`, { virtual_addresses: ids }, undo);
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
          await patchTracked(`${base}/${entry.id}/`, { monitors: ids }, undo);
          break;
        }
        case "vs-links": {
          // Manifest first (objects rendered from this application), then by
          // NetBox name — a virtual server may point at estate objects that
          // were never part of this declaration.
          const endpoint =
            op.field === "policies" ? "policies" : "protocol-profiles";
          const ids: number[] = [];
          for (const key of op.targetKeys) {
            const known = keyToId.get(key);
            if (known !== undefined) {
              ids.push(known);
              continue;
            }
            const found = await netboxRest<{ results: { id: number }[] }>(
              `${PLUGIN_BASE}/${endpoint}/?name=${encodeURIComponent(key)}`
            );
            if (found.results.length === 0)
              throw new Error(
                `"${key}" does not exist in NetBox — create it there first`
              );
            ids.push(found.results[0].id);
          }
          await patchTracked(`${base}/${entry.id}/`, { [op.field]: ids }, undo);
          break;
        }
        case "vs-snat": {
          let id: number | null = null;
          if (op.poolName !== null) {
            const found = await netboxRest<{ results: { id: number }[] }>(
              `${PLUGIN_BASE}/snat-pools/?name=${encodeURIComponent(op.poolName)}`
            );
            // Pools are pre-created estate objects — never create one here.
            if (found.results.length === 0)
              throw new Error(
                `SNAT pool "${op.poolName}" does not exist in NetBox — create it there first`
              );
            id = found.results[0].id;
          }
          await patchTracked(`${base}/${entry.id}/`, { snat_pool: id }, undo);
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
          await patchTracked(`${base}/${entry.id}/`, { [op.field]: id }, undo);
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
    // Everything minted in THIS run, deletable newest-first: creation is
    // all-or-nothing, so a failure deletes the run's objects again instead
    // of leaving half an application behind (and a retry full of
    // duplicate-name errors).
    const undo: UndoEntry[] = [];

    // A net-new application is the run's first create and its last undo.
    if (pendingApp) {
      try {
        const created = await netboxRest<{ id: number }>(
          `${PLUGIN_BASE}/applications/`,
          { method: "POST", body: pendingApp }
        );
        undo.push({
          path: `${PLUGIN_BASE}/applications/${created.id}/`,
          label: `application "${String(pendingApp.name)}"`,
        });
        manifest.appId = created.id;
        for (const entry of manifest.entries)
          if (entry.isApplication) entry.id = created.id;
      } catch (err) {
        setError(
          `Could not create the application: ${String(err instanceof Error ? err.message : err)}`
        );
        setBusy(null);
        return;
      }
    }

    const keyToId = new Map<string, number>();
    for (const entry of manifest.entries) keyToId.set(entry.as3Key, entry.id);

    // Match rows by index, not identity: the first status update replaces the
    // row object, so a captured reference stops matching and every later
    // update — including the failure detail — would silently go nowhere.
    const setStatus = (
      index: number,
      status: RowStatus,
      detail?: string
    ) =>
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, status, detail } : r))
      );

    // Row order is already creates → updates → deletes (FK-safe).
    for (const [index, row] of rows.entries()) {
      if (!row.checked || rowOpCount(row) === 0) continue;
      if (failed) break;
      setStatus(index, "applying");
      try {
        let warnings: string[] = [];
        if (row.kind === "create")
          warnings = await applyCreate(row.create, keyToId, manifest.appId, undo);
        else if (row.kind === "update")
          await applyUpdate(row.change, keyToId, undo);
        else
          await netboxRest(
            `${PLUGIN_BASE}/${row.del.entry.endpoint}/${row.del.entry.id}/`,
            { method: "DELETE" }
          );
        setStatus(index, "ok", warnings.join("; ") || undefined);
      } catch (err) {
        failed = true;
        setStatus(
          index,
          "fail",
          String(err instanceof Error ? err.message : err)
        );
        // Everything after a failure is skipped, not merely un-run: later
        // writes can depend on earlier ones, so the sequence stops. Saying so
        // beats leaving those rows looking like they are still pending.
        setRows((prev) =>
          prev.map((r, i) =>
            i > index && r.checked && rowOpCount(r) > 0 && r.status === "pending"
              ? { ...r, status: "skipped" }
              : r
          )
        );
      }
    }

    // All-or-nothing creation: a failure deletes everything this run minted,
    // newest first so references fall before their targets.
    if (failed && undo.length > 0) {
      setBusy(`Rolling back ${undo.length} created object${undo.length === 1 ? "" : "s"}…`);
      const rollbackFailures: string[] = [];
      for (const entry of [...undo].reverse()) {
        try {
          await netboxRest(entry.path, {
            method: entry.method ?? "DELETE",
            body: entry.body,
          });
        } catch (err) {
          rollbackFailures.push(
            `${entry.label}: ${String(err instanceof Error ? err.message : err)}`
          );
        }
      }
      setRows((prev) =>
        prev.map((r) =>
          r.kind !== "delete" && r.status === "ok"
            ? { ...r, status: "rolled-back" as RowStatus }
            : r
        )
      );
      if (rollbackFailures.length > 0)
        setError(
          `Rollback could not delete: ${rollbackFailures.join("; ")} — remove these in NetBox by hand.`
        );
    }

    // Read the outcome from the rows themselves — they are the record of what
    // actually happened, including the skips.
    setRows((prev) => {
      setSummary(summarizePush(prev));
      return prev;
    });

    if (!failed && pendingApp) {
      netboxSession.manifests.set(manifest.declarationId, manifest);
      netboxSession.apps = undefined; // the cached picker list is stale now
      setPendingApp(null);
    } else if (failed && pendingApp) {
      // Rolled back: put the application id back to "not created yet" so a
      // retry creates it again.
      manifest.appId = 0;
      for (const entry of manifest.entries) if (entry.isApplication) entry.id = 0;
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
          {row.status === "skipped" && (
            <span className="push-skipped" title="Not attempted — an earlier change failed">
              skipped
            </span>
          )}
          {row.status === "rolled-back" && (
            <span
              className="push-skipped"
              title="Created, then deleted again: a later step failed, and creation is all-or-nothing"
            >
              rolled back
            </span>
          )}
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
        {row.detail && (
          <div
            className={`push-field ${
              row.status === "fail" ? "push-fail" : "push-warn"
            }`}
          >
            {row.detail}
          </div>
        )}
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
          object creation/deletion. IPs and placeholder certificate records are created as
          needed. Deletions are never pre-selected. A declaration that was not
          loaded from NetBox can be created as a new application.
        </p>

        {error && <div className="modal-error">{error}</div>}

        {survey && (
          <>
            <p className="ctx-hint">
              This declaration was not loaded from NetBox, so it can be created
              as a <strong>new application</strong>. NetBox needs a few fields
              AS3 does not carry; the virtual servers are placed on the chosen
              cluster. Nothing is created until you apply, and a failed apply
              creates nothing.
            </p>
            <label className="modal-field">
              <span>Application name</span>
              <input
                value={survey.name}
                disabled={busy !== null}
                onChange={(e) => setSurvey({ ...survey, name: e.target.value })}
              />
            </label>
            <label className="modal-field">
              <span>Description</span>
              <input
                value={survey.description}
                disabled={busy !== null}
                onChange={(e) =>
                  setSurvey({ ...survey, description: e.target.value })
                }
              />
            </label>
            <label className="modal-field">
              <span>SNOW sys_id (optional)</span>
              <input
                value={survey.snowSysId}
                disabled={busy !== null}
                onChange={(e) =>
                  setSurvey({ ...survey, snowSysId: e.target.value })
                }
              />
            </label>
            <label className="modal-field">
              <span>Cluster</span>
              <select
                value={survey.clusterId ?? ""}
                disabled={busy !== null}
                onChange={(e) =>
                  setSurvey({
                    ...survey,
                    clusterId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Select a cluster…</option>
                {survey.clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {!error && !survey && rows.length === 0 && !pendingApp && !busy && (
          <p className="ctx-hint">
            No pushable changes — the declaration matches NetBox.
          </p>
        )}

        {(rows.length > 0 || pendingApp) && (
          <div className="push-list">
            {pendingApp && (
              <div className="push-row">
                <div className="push-row-head">
                  <span className="push-kind create">CREATE</span>
                  <span className="push-name">
                    {String(pendingApp.name)}
                    <span className="push-class">Application</span>
                  </span>
                </div>
                <div className="push-field">
                  <span className="push-to">
                    create application — first, and removed again if anything
                    after it fails
                  </span>
                </div>
              </div>
            )}
            {rows.map((row, i) => renderRow(row, i))}
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

        {summary && (
          <div
            className={`push-summary${summary.failed > 0 ? " push-summary-failed" : ""}`}
            role="status"
          >
            {describePush(summary)}
            {summary.failed > 0 &&
              " — nothing after the failure was attempted, because later writes can depend on earlier ones."}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{done ? "Done" : "Close"}</button>
          {!done && survey && (
            <button
              className="primary"
              disabled={
                busy !== null ||
                survey.name.trim() === "" ||
                survey.clusterId === null
              }
              onClick={() => void continueFromSurvey()}
            >
              {busy ?? "Continue…"}
            </button>
          )}
          {!done && !survey && (
            <button
              className="primary"
              disabled={busy !== null || (applicable.length === 0 && !pendingApp)}
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
