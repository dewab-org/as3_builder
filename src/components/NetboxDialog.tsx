import { useEffect, useState } from "react";
import {
  APPLICATION_LIST_QUERY,
  applicationGraphQuery,
  buildManifest,
  renderNetboxApp,
} from "../engine";
import {
  invalidateNetboxAuth,
  netboxGraphql,
  netboxSession,
  type AppEntry,
} from "../netboxSession";

interface NetboxDialogProps {
  onLoad: (text: string) => void;
  onClose: () => void;
}

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
  const [url, setUrl] = useState(netboxSession.url);
  const [username, setUsername] = useState(netboxSession.username);
  const [password, setPassword] = useState(netboxSession.password);
  const [validateCert, setValidateCert] = useState(netboxSession.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [apps, setApps] = useState<AppEntry[] | undefined>(netboxSession.apps);
  const [selectedApp, setSelectedApp] = useState(
    netboxSession.apps?.[0]?.id ?? ""
  );
  const [appFilter, setAppFilter] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  netboxSession.url = url;
  netboxSession.username = username;
  netboxSession.password = password;
  netboxSession.validateCert = validateCert;

  // Cached connection: if we already hold a token but no app list yet,
  // connect immediately on open.
  useEffect(() => {
    if (netboxSession.authHeader && !netboxSession.apps) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canConnect = !busy && url.trim() !== "" && username !== "";

  async function connect() {
    setBusy("Connecting…");
    setError(undefined);
    setApps(undefined);
    try {
      const data = await netboxGraphql<{ application_list: AppEntry[] }>(
        APPLICATION_LIST_QUERY
      );
      const list = [...data.application_list].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      netboxSession.apps = list;
      setApps(list);
      if (list.length > 0) setSelectedApp(list[0].id);
    } catch (err) {
      invalidateNetboxAuth(); // stale token? re-provision next time
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
      const data = await netboxGraphql<{
        application_list: Record<string, unknown>[];
      }>(applicationGraphQuery(id));
      const app = data.application_list[0];
      if (!app) throw new Error("Application not found in NetBox");
      const { declaration, warnings } = renderNetboxApp(app);
      const manifest = buildManifest(app, declaration);
      netboxSession.manifests.set(manifest.declarationId, manifest);
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
              netboxSession.authHeader = "";
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
              netboxSession.authHeader = "";
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
                .filter(
                  (x): x is { app: AppEntry; rank: number } => x.rank !== null
                )
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
