import { useState } from "react";
import { APPLICATION_LIST_QUERY } from "../engine";
import {
  invalidateNetboxAuth,
  netboxGraphql,
  netboxSession,
  type AppEntry,
} from "../netboxSession";

interface NetboxConnectDialogProps {
  /** Problems the server spotted in its own configuration (see appConfig). */
  configWarnings?: string[];
  /** Called once a connection is established and the application list is
   * cached — the moment Load and Push become usable. */
  onConnected: () => void;
  onClose: () => void;
}

/** Connection half of the NetBox integration: URL, credentials, and the
 * token/application-list round trip. Loading and pushing live in their own
 * dialogs and require this to have succeeded once per session. */
export default function NetboxConnectDialog({
  configWarnings = [],
  onConnected,
  onClose,
}: NetboxConnectDialogProps) {
  const [url, setUrl] = useState(netboxSession.url);
  const [username, setUsername] = useState(netboxSession.username);
  const [password, setPassword] = useState(netboxSession.password);
  const [token, setToken] = useState(netboxSession.token);
  // A token skips provisioning and works for accounts that cannot mint one.
  const [authMode, setAuthMode] = useState<"token" | "password">(
    netboxSession.token ? "token" : "password"
  );
  const [validateCert, setValidateCert] = useState(netboxSession.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  netboxSession.url = url;
  netboxSession.username = authMode === "password" ? username : "";
  netboxSession.password = authMode === "password" ? password : "";
  netboxSession.token = authMode === "token" ? token : "";
  netboxSession.validateCert = validateCert;

  const canConnect =
    !busy &&
    url.trim() !== "" &&
    (authMode === "token" ? token.trim() !== "" : username !== "");

  async function connect() {
    setBusy("Connecting…");
    setError(undefined);
    try {
      const data = await netboxGraphql<{ application_list: AppEntry[] }>(
        APPLICATION_LIST_QUERY
      );
      netboxSession.apps = [...data.application_list].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      onConnected();
    } catch (err) {
      invalidateNetboxAuth(); // stale token? re-provision next time
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connect to NetBox</h2>
        <p className="ctx-hint">
          Establishes this session's NetBox connection — used by “Load from
          NetBox…” and “Push to NetBox…”.
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
          <span>Authenticate with</span>
          <select
            value={authMode}
            onChange={(e) => {
              setAuthMode(e.target.value as "token" | "password");
              netboxSession.authHeader = "";
            }}
          >
            <option value="token">API token</option>
            <option value="password">Username &amp; password</option>
          </select>
        </label>
        {authMode === "token" ? (
          <label className="modal-field">
            <span>API token</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="nbt_… or a 40-character key"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                netboxSession.authHeader = "";
              }}
            />
          </label>
        ) : (
          <>
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
          </>
        )}
        <label className="modal-check">
          <input
            type="checkbox"
            checked={validateCert}
            onChange={(e) => setValidateCert(e.target.checked)}
          />
          Validate TLS certificate (https only)
        </label>

        {configWarnings.length > 0 && (
          <div className="modal-warnings">
            <strong>Check the server configuration:</strong>
            <ul>
              {configWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            disabled={!canConnect}
            onClick={() => void connect()}
          >
            {busy ?? "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
