import { useState } from "react";
import { substituteDryRunCertificates } from "../engine";

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
  tenant: "Applications",
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
  // Direct apply is the exception, not the route: it walks three gates
  // (0 = not applying, 1 = "use Ansible", 2 = type the host, 3 = final).
  const [applyGate, setApplyGate] = useState(0);
  const [hostConfirm, setHostConfirm] = useState("");
  /** Set once a dry run finishes, so the gates can say whether one was done
   * against this exact host/tenant and whether it came back clean. */
  const [lastDryRun, setLastDryRun] = useState<{
    host: string;
    tenant: string;
    ok: boolean;
  } | null>(null);
  const [substituted, setSubstituted] = useState<string[]>([]);

  const canRun =
    !running && host.trim() !== "" && username !== "" && tenant.trim() !== "";
  const dryRunMatches =
    lastDryRun !== null &&
    lastDryRun.host === host.trim() &&
    lastDryRun.tenant === tenant.trim();

  // Keep the in-memory cache current so reopening the dialog restores fields.
  remembered.host = host;
  remembered.username = username;
  remembered.password = password;
  remembered.validateCert = validateCert;
  remembered.tenant = tenant;

  function cancelApply() {
    setApplyGate(0);
    setHostConfirm("");
  }

  function setStep(index: number, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function run(dryRun: boolean) {
    const applyLabel = dryRun ? "Dry-run declaration" : "Apply declaration";
    setRunning(true);
    cancelApply();
    setRawResponse(undefined);
    setShowRaw(false);
    setSteps([
      { label: "Check AS3 API availability", state: "running" },
      { label: applyLabel, state: "pending" },
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

      // Step 2: submit. controls.dryRun is forced to match the chosen mode,
      // overriding whatever the declaration itself says.
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
        dryRun,
      };
      // Certificates live in the certificate estate, not in the declaration,
      // so a dry run would fail on material it cannot see. Swap in a
      // disposable placeholder — never on an apply, which needs the real one.
      if (dryRun) {
        const swap = substituteDryRunCertificates(declaration);
        declaration = swap.declaration;
        declaration.controls = {
          ...(typeof declaration.controls === "object"
            ? declaration.controls
            : {}),
          class: "Controls",
          dryRun,
        };
        setSubstituted(swap.substituted);
      } else {
        setSubstituted([]);
      }
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
      if (dryRun)
        setLastDryRun({ host: host.trim(), tenant: tenant.trim(), ok: declRes.ok });
      if (declRes.ok) {
        setStep(1, {
          state: "ok",
          detail:
            messages.join(" · ") ||
            (dryRun
              ? "Declaration accepted (no changes were made — dry run)"
              : "Declaration applied"),
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
          Applying for real belongs in the Ansible workflow; the Apply button
          here is a deliberate exception and asks accordingly.
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
            {substituted.length > 0 && (
              <div className="push-warn">
                Dry run only: certificate material for{" "}
                {substituted.map((k) => (
                  <code key={k}>{k}</code>
                ))}{" "}
                was replaced with a disposable placeholder, because NetBox
                stores certificate metadata rather than the material itself.
                What the BIG-IP validated is not your real certificate.
              </div>
            )}
            <button className="modal-link" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? "Hide" : "Show"} full response
            </button>
            {showRaw && <pre>{rawResponse}</pre>}
          </div>
        )}

        {applyGate === 1 && (
          <div className="modal-confirm">
            <strong>This is not the normal way to apply.</strong> Configuration
            reaches the BIG-IPs through the Ansible workflow, which keeps the
            estate reviewable and repeatable. Applying from here bypasses it and
            changes a live device directly — do it only when you have a specific
            reason to.
            <div className="modal-confirm-actions">
              <button onClick={cancelApply}>Cancel</button>
              <button onClick={() => setApplyGate(2)}>
                I understand — continue
              </button>
            </div>
          </div>
        )}

        {applyGate === 2 && (
          <div className="modal-confirm">
            {dryRunMatches ? (
              lastDryRun?.ok ? (
                <div>A dry run against this host and tenant passed.</div>
              ) : (
                <div className="push-fail">
                  The last dry run against this host and tenant FAILED.
                </div>
              )
            ) : (
              <div className="push-warn">
                No dry run has been done against{" "}
                <code>{host.trim()}</code> / <code>{tenant.trim()}</code> in this
                session. Run one first unless you know why you're skipping it.
              </div>
            )}
            <div>
              Type the host — <code>{host.trim()}</code> — to confirm you are
              applying to the right device:
            </div>
            <input
              type="text"
              value={hostConfirm}
              onChange={(e) => setHostConfirm(e.target.value)}
              placeholder={host.trim()}
              autoFocus
            />
            <div className="modal-confirm-actions">
              <button onClick={cancelApply}>Cancel</button>
              <button
                disabled={hostConfirm.trim() !== host.trim()}
                onClick={() => setApplyGate(3)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {applyGate === 3 && (
          <div className="modal-confirm">
            <strong>Last chance.</strong> This writes tenant{" "}
            <code>{tenant.trim()}</code> to <code>{host.trim()}</code> now.
            Existing applications in that tenant that are absent from this
            declaration will be REMOVED by AS3.
            <div className="modal-confirm-actions">
              <button onClick={cancelApply}>Cancel, use Ansible</button>
              <button
                className="danger"
                onClick={() => {
                  cancelApply();
                  void run(false);
                }}
              >
                Apply to {host.trim()} now
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button
            className="danger-outline"
            disabled={!canRun}
            onClick={() => setApplyGate(1)}
          >
            Apply…
          </button>
          <button className="primary" disabled={!canRun} onClick={() => run(true)}>
            {running ? "Running…" : "Run dry-run"}
          </button>
        </div>
      </div>
    </div>
  );
}
