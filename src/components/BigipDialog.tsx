import { useState } from "react";

interface BigipDialogProps {
  /** Current editor text (the declaration to dry-run). */
  declarationText: string;
  onClose: () => void;
}

interface StepState {
  label: string;
  state: "pending" | "running" | "ok" | "fail";
  detail?: string;
}

// Connection details survive closing/reopening the dialog (in memory only —
// cleared on page refresh, never written to storage).
const remembered = {
  host: "",
  username: "",
  password: "",
  tenant: "Tenant1",
  validateCert: true,
};

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

export default function BigipDialog({
  declarationText,
  onClose,
}: BigipDialogProps) {
  const [host, setHost] = useState(remembered.host);
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState(remembered.password);
  const [validateCert, setValidateCert] = useState(remembered.validateCert);
  const [tenant, setTenant] = useState(remembered.tenant);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [rawResponse, setRawResponse] = useState<string | undefined>();
  const [showRaw, setShowRaw] = useState(false);

  const canRun =
    !running && host.trim() !== "" && username !== "" && tenant.trim() !== "";

  // Keep the in-memory cache current so reopening the dialog restores fields.
  remembered.host = host;
  remembered.username = username;
  remembered.password = password;
  remembered.validateCert = validateCert;
  remembered.tenant = tenant;

  function setStep(index: number, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function run() {
    setRunning(true);
    setRawResponse(undefined);
    setShowRaw(false);
    setSteps([
      { label: "Check AS3 API availability", state: "running" },
      { label: "Dry-run declaration", state: "pending" },
    ]);
    const headers = authHeaders(host, username, password, validateCert);

    try {
      // Step 1: AS3 availability + version.
      const infoRes = await fetch("/bigip-proxy/mgmt/shared/appsvcs/info", {
        headers,
      });
      const infoBody = await infoRes.json().catch(() => ({}));
      if (!infoRes.ok) {
        const why =
          infoRes.status === 401
            ? "Authentication failed (check username/password)"
            : infoRes.status === 404
              ? "AS3 is not installed on this BIG-IP (/mgmt/shared/appsvcs/info returned 404)"
              : (infoBody.error ?? `HTTP ${infoRes.status}`);
        setStep(0, { state: "fail", detail: why });
        return;
      }
      setStep(0, {
        state: "ok",
        detail: `AS3 ${infoBody.version ?? "?"} (schema ${infoBody.schemaCurrent ?? "?"})`,
      });

      // Step 2: dry-run. Per-app POST with controls.dryRun forced on.
      setStep(1, { state: "running" });
      let declaration: Record<string, unknown>;
      try {
        declaration = JSON.parse(declarationText) as Record<string, unknown>;
      } catch {
        setStep(1, { state: "fail", detail: "Editor content is not valid JSON" });
        return;
      }
      declaration.controls = {
        ...(typeof declaration.controls === "object" ? declaration.controls : {}),
        class: "Controls",
        dryRun: true,
      };
      const declRes = await fetch(
        `/bigip-proxy/mgmt/shared/appsvcs/declare/${encodeURIComponent(tenant.trim())}/applications`,
        { method: "POST", headers, body: JSON.stringify(declaration) }
      );
      const declBody = await declRes.json().catch(() => ({}));
      setRawResponse(JSON.stringify(declBody, null, 2));
      setShowRaw(true); // dry-run results are the point — show them
      const results: { code?: number; message?: string }[] = Array.isArray(
        declBody.results
      )
        ? declBody.results
        : [];
      const messages = results
        .map((r) => `${r.code ?? ""} ${r.message ?? ""}`.trim())
        .filter(Boolean);
      if (declRes.ok) {
        setStep(1, {
          state: "ok",
          detail:
            messages.join(" · ") ||
            "Declaration accepted (no changes were made — dry run)",
        });
      } else {
        setStep(1, {
          state: "fail",
          detail:
            messages.join(" · ") ||
            declBody.error ||
            declBody.message ||
            `HTTP ${declRes.status}`,
        });
      }
    } catch (err) {
      setSteps((prev) =>
        prev.map((s) =>
          s.state === "running"
            ? { ...s, state: "fail", detail: String(err) }
            : s
        )
      );
    } finally {
      setRunning(false);
    }
  }

  const stepIcon = { pending: "○", running: "◐", ok: "✓", fail: "✗" } as const;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Validate on BIG-IP (dry run)</h2>
        <p className="ctx-hint">
          Checks the AS3 API, then submits the current declaration with{" "}
          <code>controls.dryRun</code> — no changes are made on the BIG-IP.
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
        <label className="modal-field">
          <span>Tenant</span>
          <input
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            title="Per-app declarations are validated against a tenant"
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

        {steps.length > 0 && (
          <div className="modal-steps">
            {steps.map((s) => (
              <div key={s.label} className={`modal-step ${s.state}`}>
                <span className="modal-step-icon">{stepIcon[s.state]}</span>
                <span>
                  {s.label}
                  {s.detail && <div className="modal-step-detail">{s.detail}</div>}
                </span>
              </div>
            ))}
          </div>
        )}

        {rawResponse && (
          <div className="modal-raw">
            <button className="modal-link" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? "Hide" : "Show"} full response
            </button>
            {showRaw && <pre>{rawResponse}</pre>}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={!canRun} onClick={run}>
            {running ? "Running…" : "Run dry-run"}
          </button>
        </div>
      </div>
    </div>
  );
}
