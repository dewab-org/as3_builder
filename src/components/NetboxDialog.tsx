import { useEffect, useState } from "react";
import {
  APPLICATION_LIST_QUERY,
  applicationGraphQuery,
  renderNetboxApp,
} from "../engine";

interface NetboxDialogProps {
  onLoad: (text: string) => void;
  onClose: () => void;
}

interface AppEntry {
  id: string;
  name: string;
  description?: string;
}

// Connection details, provisioned token, and the fetched application list
// survive closing/reopening the dialog (in memory only — cleared on page
// refresh, never persisted). A cached token + app list means reopening the
// dialog goes straight to the picker without re-connecting.
const remembered = {
  url: "http://localhost:8080",
  username: "",
  password: "",
  validateCert: true,
  authHeader: "" as string,
  apps: undefined as AppEntry[] | undefined,
};

// Fuzzy match: rank contiguous substring hits above in-order subsequence
// hits; everything else is filtered out.
export function fuzzyRank(name: string, query: string): number | null {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const idx = n.indexOf(q);
  if (idx >= 0) return idx === 0 ? 0 : 1;
  let pos = 0;
  for (const ch of q) {
    pos = n.indexOf(ch, pos);
    if (pos < 0) return null;
    pos += 1;
  }
  return 2;
}

export default function NetboxDialog({ onLoad, onClose }: NetboxDialogProps) {
  const [url, setUrl] = useState(remembered.url);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState(remembered.password);
  const [validateCert, setValidateCert] = useState(remembered.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [apps, setApps] = useState<AppEntry[] | undefined>(remembered.apps);
  const [selectedApp, setSelectedApp] = useState(
    remembered.apps?.[0]?.id ?? ""
  );
  const [appFilter, setAppFilter] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  // Cached connection: if we already hold a token but no app list yet,
  // connect immediately on open.
  useEffect(() => {
    if (remembered.authHeader && !remembered.apps) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  remembered.url = url;
  remembered.username = username;
  remembered.password = password;
  remembered.validateCert = validateCert;

  const canConnect = !busy && url.trim() !== "" && username !== "";

  function proxyHeaders(auth: string): Record<string, string> {
    return {
      authorization: auth,
      "x-netbox-target": url.trim().replace(/\/+$/, ""),
      "x-netbox-validate-cert": validateCert ? "1" : "0",
      "content-type": "application/json",
    };
  }

  async function graphql<T>(auth: string, query: string): Promise<T> {
    const res = await fetch("/netbox-proxy/graphql/", {
      method: "POST",
      headers: proxyHeaders(auth),
      body: JSON.stringify({ query }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? body.detail ?? `HTTP ${res.status}`);
    if (body.errors?.length) throw new Error(body.errors[0].message);
    return body.data as T;
  }

  // Provision an API token from username/password. NetBox ≥4.3 returns a v2
  // token (Bearer nbt_<key>.<token>); older versions return a 40-char key
  // used as `Token <key>`.
  async function provisionAuth(): Promise<string> {
    if (remembered.authHeader) return remembered.authHeader;
    const res = await fetch("/netbox-proxy/api/users/tokens/provision/", {
      method: "POST",
      headers: proxyHeaders(""),
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 403 || res.status === 401
          ? "Authentication failed (check username/password)"
          : (body.error ?? body.detail ?? `HTTP ${res.status}`)
      );
    }
    const header = body.token
      ? `Bearer nbt_${body.key}.${body.token}`
      : `Token ${body.key}`;
    remembered.authHeader = header;
    return header;
  }

  async function connect() {
    setBusy("Connecting…");
    setError(undefined);
    setApps(undefined);
    try {
      const auth = await provisionAuth();
      const data = await graphql<{ application_list: AppEntry[] }>(
        auth,
        APPLICATION_LIST_QUERY
      );
      const list = [...data.application_list].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      remembered.apps = list;
      setApps(list);
      if (list.length > 0) setSelectedApp(list[0].id);
    } catch (err) {
      remembered.authHeader = ""; // stale token? re-provision next time
      remembered.apps = undefined;
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  async function loadApp(id: string = selectedApp) {
    if (!id) return;
    setBusy("Rendering AS3…");
    setError(undefined);
    setWarnings([]);
    try {
      const auth = await provisionAuth();
      const data = await graphql<{ application_list: Record<string, unknown>[] }>(
        auth,
        applicationGraphQuery(id)
      );
      const app = data.application_list[0];
      if (!app) throw new Error("Application not found in NetBox");
      const { declaration, warnings } = renderNetboxApp(app);
      setWarnings(warnings);
      onLoad(JSON.stringify(declaration, null, 2) + "\n");
      if (warnings.length === 0) onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Load from NetBox</h2>
        <p className="ctx-hint">
          Reads a load-balancer application from NetBox and renders it as a
          per-app AS3 declaration in the editor.
        </p>
        <label className="modal-field">
          <span>NetBox URL</span>
          <input
            type="text"
            placeholder="http://netbox.example.com:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
        </label>
        <label className="modal-field">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              remembered.authHeader = "";
            }}
          />
        </label>
        <label className="modal-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              remembered.authHeader = "";
            }}
          />
        </label>
        <label className="modal-check">
          <input
            type="checkbox"
            checked={validateCert}
            onChange={(e) => setValidateCert(e.target.checked)}
          />
          Validate TLS certificate (https only)
        </label>

        {apps && apps.length > 0 && (
          <div className="app-picker">
            <input
              type="search"
              placeholder={`Search ${apps.length} applications…`}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            />
            <div className="app-picker-list">
              {apps
                .map((a) => ({ app: a, rank: fuzzyRank(a.name, appFilter) }))
                .filter((x): x is { app: AppEntry; rank: number } => x.rank !== null)
                .sort(
                  (a, b) =>
                    a.rank - b.rank || a.app.name.localeCompare(b.app.name)
                )
                .map(({ app: a }) => (
                  <div
                    key={a.id}
                    className={`app-picker-item${a.id === selectedApp ? " selected" : ""}`}
                    onClick={() => setSelectedApp(a.id)}
                    onDoubleClick={() => {
                      setSelectedApp(a.id);
                      void loadApp(a.id);
                    }}
                    title={a.description}
                  >
                    <span>{a.name}</span>
                    {a.description && (
                      <span className="app-desc">{a.description}</span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
        {apps && apps.length === 0 && (
          <p className="ctx-hint">No applications found in this NetBox.</p>
        )}

        {error && <div className="modal-error">{error}</div>}

        {warnings.length > 0 && (
          <div className="modal-warnings">
            <strong>Loaded with warnings:</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          {!apps ? (
            <button className="primary" disabled={!canConnect} onClick={connect}>
              {busy ?? "Connect"}
            </button>
          ) : (
            <>
              <button disabled={!!busy} onClick={connect}>
                Refresh
              </button>
              <button
                className="primary"
                disabled={!!busy || !selectedApp}
                onClick={() => loadApp()}
              >
                {busy ?? "Load as AS3"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
