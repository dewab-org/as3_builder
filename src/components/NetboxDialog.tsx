import { useEffect, useState } from "react";
import {
  APPLICATION_LIST_QUERY,
  applicationGraphQuery,
  buildManifest,
  renderNetboxApp,
} from "../engine";
import { fuzzyRank } from "./fuzzy";
import {
  invalidateNetboxAuth,
  netboxGraphql,
  netboxSession,
  type AppEntry,
} from "../netboxSession";

interface NetboxDialogProps {
  onLoad: (text: string) => void;
  onClose: () => void;
  /** Opens the Connect dialog in this dialog's place. */
  onConnect: () => void;
  /** Deep link: load this application automatically once the list is here. */
  autoLoadAppId?: string;
}

/** Application picker half of the NetBox integration. The connection itself
 * is "Connect to NetBox…" (NetboxConnectDialog); this dialog only consumes
 * the cached session. */
export default function NetboxDialog({
  onLoad,
  onClose,
  onConnect,
  autoLoadAppId,
}: NetboxDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [apps, setApps] = useState<AppEntry[] | undefined>(netboxSession.apps);
  const [selectedApp, setSelectedApp] = useState(
    autoLoadAppId ?? netboxSession.apps?.[0]?.id ?? ""
  );
  const [appFilter, setAppFilter] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  // Deep link: the Connect dialog already ran; load the target right away.
  useEffect(() => {
    if (autoLoadAppId && netboxSession.apps?.some((a) => a.id === autoLoadAppId))
      void loadApp(autoLoadAppId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setBusy("Refreshing…");
    setError(undefined);
    try {
      const data = await netboxGraphql<{ application_list: AppEntry[] }>(
        APPLICATION_LIST_QUERY
      );
      const list = [...data.application_list].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      netboxSession.apps = list;
      setApps(list);
      if (!list.some((a) => a.id === selectedApp))
        setSelectedApp(list[0]?.id ?? "");
    } catch (err) {
      invalidateNetboxAuth(); // stale token? reconnect provisions a fresh one
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
          Reads a load-balancer application from{" "}
          <code>{netboxSession.url}</code> and renders it as a per-app AS3
          declaration in the editor.
        </p>

        {!apps && (
          <p className="ctx-hint">
            Not connected to NetBox yet — connect first, then pick an
            application here.
          </p>
        )}

        {apps && apps.length > 0 && (
          <div className="app-picker">
            <input
              type="search"
              placeholder={`Search ${apps.length} applications…`}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              autoFocus
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
            <button className="primary" onClick={onConnect}>
              Connect to NetBox…
            </button>
          ) : (
            <>
              <button disabled={!!busy} onClick={() => void refresh()}>
                Refresh
              </button>
              <button
                className="primary"
                disabled={!!busy || !selectedApp}
                onClick={() => void loadApp()}
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
