import { useEffect, useState } from "react";
import {
  bigipAuthHeaders,
  rememberBigip,
  remembered,
  setBigipConnected,
} from "./bigipSession";

interface BigipConnectDialogProps {
  onConnected: () => void;
  onClose: () => void;
}

/** Connection half of the BIG-IP integration, mirroring "Connect to
 * NetBox…": device, credentials, and a round trip to AS3's info endpoint.
 * The Load and Validate dialogs reuse the remembered credentials. */
export default function BigipConnectDialog({
  onConnected,
  onClose,
}: BigipConnectDialogProps) {
  const [host, setHost] = useState(remembered.host);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState(remembered.password);
  const [validateCert, setValidateCert] = useState(remembered.validateCert);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  // Effect, not render: changing the device flips the toolbar's Connected
  // state, which is another component's state.
  useEffect(() => {
    rememberBigip({ host, username, password, validateCert });
  }, [host, username, password, validateCert]);

  const canConnect = !busy && host.trim() !== "" && username !== "";

  async function connect() {
    setBusy("Connecting…");
    setError(undefined);
    try {
      const res = await fetch(`/bigip-proxy/mgmt/shared/appsvcs/info`, {
        headers: bigipAuthHeaders(),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const rec =
          typeof body === "object" && body !== null
            ? (body as Record<string, unknown>)
            : {};
        const detail = (rec.message ?? rec.error) as string | undefined;
        throw new Error(
          res.status === 401
            ? "Authentication failed (check username/password)"
            : (detail ?? `HTTP ${res.status}`)
        );
      }
      remembered.as3Version =
        typeof body === "object" && body !== null
          ? String((body as Record<string, unknown>).version ?? "")
          : "";
      setBigipConnected(true);
      onConnected();
    } catch (err) {
      setBigipConnected(false);
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connect to BIG-IP</h2>
        <p className="ctx-hint">
          Verifies this session's BIG-IP connection via AS3's info endpoint —
          used by “Load from BIG-IP…” and “Validate on BIG-IP…”.
        </p>
        <label className="modal-field">
          <span>BIG-IP host</span>
          <input
            type="text"
            placeholder="bigip.example.com"
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
