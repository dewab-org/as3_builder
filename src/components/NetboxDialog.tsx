import { useState } from "react";
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

// Connection details + provisioned token survive closing/reopening the dialog
// (in memory only — cleared on page refresh, never persisted).
const remembered = {
  url: "http://localhost:8080",
  username: "",
  password: "",
  validateCert: true,
  authHeader: "" as string,
};

export default function NetboxDialog({ onLoad, onClose }: NetboxDialogProps) {
  const [url, setUrl] = useState(remembered.url);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState(remembered.password);
  const [validateCert, setValidateCert] = useState(remembered.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [apps, setApps] = useState<AppEntry[] | undefined>();
  const [selectedApp, setSelectedApp] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

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
      setApps(list);
      if (list.length > 0) setSelectedApp(list[0].id);
    } catch (err) {
      remembered.authHeader = ""; // stale token? re-provision next time
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  async function loadApp() {
    if (!selectedApp) return;
    setBusy("Rendering AS3…");
    setError(undefined);
    setWarnings([]);
    try {
      const auth = await provisionAuth();
      const data = await graphql<{ application_list: Record<string, unknown>[] }>(
        auth,
        applicationGraphQuery(selectedApp)
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

        {apps && (
          <label className="modal-field">
            <span>Application</span>
            <select
              value={selectedApp}
              onChange={(e) => setSelectedApp(e.target.value)}
            >
              {apps.map((a) => (
                <option key={a.id} value={a.id} title={a.description}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
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
                onClick={loadApp}
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
