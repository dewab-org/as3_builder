import { useEffect, useState } from "react";
import { remembered } from "./bigipSession";

interface BigipLoadDialogProps {
  onLoad: (text: string) => void;
  onClose: () => void;
}

/** Tenant → application names, read from the running configuration. */
interface TenantApps {
  tenant: string;
  schemaVersion?: string;
  apps: { name: string; classes: number }[];
}

function authHeaders(
  host: string,
  username: string,
  password: string,
  validateCert: boolean
): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${username}:${password}`)}`,
    "x-bigip-target": host.trim(),
    "x-bigip-validate-cert": validateCert ? "1" : "0",
    "content-type": "application/json",
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read a running configuration back through AS3's per-application API:
 * GET /declare lists the tenants, and GET /declare/<tenant>/applications
 * returns each tenant's applications already in the per-app shape this
 * editor works on — no conversion involved, this IS the deployed source
 * of truth as AS3 sees it.
 */
export default function BigipLoadDialog({ onLoad, onClose }: BigipLoadDialogProps) {
  const [host, setHost] = useState(remembered.host);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState(remembered.password);
  const [validateCert, setValidateCert] = useState(remembered.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [tenants, setTenants] = useState<TenantApps[] | undefined>();
  const [selected, setSelected] = useState<{ tenant: string; app: string }>();
  const [filter, setFilter] = useState("");

  // Same in-memory cache the validate dialog uses, so one set of device
  // credentials serves both.
  remembered.host = host;
  remembered.username = username;
  remembered.password = password;
  remembered.validateCert = validateCert;

  const canConnect = !busy && host.trim() !== "" && username !== "";

  async function bigipGet(path: string): Promise<unknown> {
    const res = await fetch(`/bigip-proxy${path}`, {
      headers: authHeaders(host, username, password, validateCert),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = isRecord(body)
        ? ((body.message ?? body.error) as string | undefined)
        : undefined;
      throw new Error(detail ?? `HTTP ${res.status}`);
    }
    return body;
  }

  async function connect() {
    setBusy("Reading tenants…");
    setError(undefined);
    setTenants(undefined);
    setSelected(undefined);
    try {
      // The whole-declaration GET names the tenants; 204 means none.
      const declaration = await bigipGet("/mgmt/shared/appsvcs/declare").catch(
        (err: Error) => {
          if (err.message === "HTTP 204") return {};
          throw err;
        }
      );
      const tenantNames = isRecord(declaration)
        ? Object.entries(declaration)
            .filter(([, v]) => isRecord(v) && v.class === "Tenant")
            .map(([name]) => name)
        : [];

      const result: TenantApps[] = [];
      for (const tenant of tenantNames) {
        setBusy(`Reading ${tenant}…`);
        const perApp = await bigipGet(
          `/mgmt/shared/appsvcs/declare/${encodeURIComponent(tenant)}/applications`
        );
        if (!isRecord(perApp)) continue;
        const apps = Object.entries(perApp)
          .filter(([, v]) => isRecord(v) && v.class === "Application")
          .map(([name, v]) => ({
            name,
            classes: Object.values(v as Record<string, unknown>).filter(
              (m) => isRecord(m) && typeof m.class === "string"
            ).length,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        result.push({
          tenant,
          schemaVersion: isRecord(perApp)
            ? (perApp.schemaVersion as string | undefined)
            : undefined,
          apps,
        });
      }
      setTenants(result);
      const first = result.find((t) => t.apps.length > 0);
      if (first) setSelected({ tenant: first.tenant, app: first.apps[0].name });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  async function loadApp() {
    if (!selected) return;
    setBusy(`Loading ${selected.app}…`);
    setError(undefined);
    try {
      const perApp = await bigipGet(
        `/mgmt/shared/appsvcs/declare/${encodeURIComponent(selected.tenant)}/applications`
      );
      if (!isRecord(perApp) || !isRecord(perApp[selected.app]))
        throw new Error(`Application "${selected.app}" not found on the device`);
      // Exactly the per-app document shape the editor works on. The id names
      // its origin so a later "where did this come from?" has an answer.
      const doc: Record<string, unknown> = {
        id: `bigip-${host.trim()}-${selected.tenant}-${selected.app}`,
        schemaVersion: perApp.schemaVersion ?? "3.55.0",
        [selected.app]: perApp[selected.app],
      };
      onLoad(JSON.stringify(doc, null, 2) + "\n");
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  // Reconnect-free reopen: with credentials remembered and nothing loaded
  // yet, go straight to the tenant list.
  useEffect(() => {
    if (canConnect && tenants === undefined && host && username && password)
      void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = filter.trim().toLowerCase();
  const shown = (tenants ?? [])
    .map((t) => ({
      ...t,
      apps: t.apps.filter(
        (a) => !query || a.name.toLowerCase().includes(query)
      ),
    }))
    .filter((t) => t.apps.length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Load from BIG-IP</h2>
        <p className="ctx-hint">
          Reads the running configuration through AS3's per-application API —
          what the device is actually serving, tenant by tenant. NetBox
          write-back does not apply to a document loaded this way; it has no
          NetBox provenance.
        </p>
        <label className="modal-field">
          <span>BIG-IP host/IP</span>
          <input
            type="text"
            placeholder="bigip.example.com or 10.1.1.245:8443"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            autoFocus
          />
        </label>
        <label className="modal-field">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="modal-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="modal-check">
          <input
            type="checkbox"
            checked={validateCert}
            onChange={(e) => setValidateCert(e.target.checked)}
          />
          Validate TLS certificate
        </label>

        {tenants && tenants.every((t) => t.apps.length === 0) && (
          <div className="modal-warnings">
            No AS3 applications on this device — nothing has been deployed
            through AS3, or the tenants are empty.
          </div>
        )}

        {tenants && tenants.some((t) => t.apps.length > 0) && (
          <div className="app-picker">
            <input
              type="search"
              placeholder={`Search ${tenants.reduce((n, t) => n + t.apps.length, 0)} applications…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="app-picker-list">
              {shown.map((t) => (
                <div key={t.tenant}>
                  <div className="app-picker-tenant">
                    {t.tenant}
                    {t.schemaVersion && (
                      <span className="push-class"> schema {t.schemaVersion}</span>
                    )}
                  </div>
                  {t.apps.map((a) => (
                    <div
                      key={`${t.tenant}/${a.name}`}
                      className={`app-picker-item${
                        selected?.tenant === t.tenant && selected?.app === a.name
                          ? " selected"
                          : ""
                      }`}
                      onClick={() => setSelected({ tenant: t.tenant, app: a.name })}
                      onDoubleClick={() => void loadApp()}
                    >
                      {a.name}
                      <span className="push-class">
                        {a.classes} object{a.classes === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button disabled={!canConnect} onClick={() => void connect()}>
            {tenants ? "Refresh" : "Connect"}
          </button>
          <button
            className="primary"
            disabled={!selected || busy !== null}
            onClick={() => void loadApp()}
          >
            {busy ?? "Load as AS3"}
          </button>
        </div>
      </div>
    </div>
  );
}
