import { SCHEMA_LIST } from "../schemas";
import { APP_AUTHOR, APP_REPO, APP_VERSION } from "../version";

/** Who made this and which build it is — the question About exists to
 * answer, plus the schema versions the answer usually leads to. */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <h2>AS3 Builder</h2>
        <div className="about-grid">
          <span>Version</span>
          <span>{APP_VERSION}</span>
          <span>Author</span>
          <span>{APP_AUTHOR}</span>
          <span>Source</span>
          <span>
            <a href={APP_REPO} target="_blank" rel="noreferrer">
              {APP_REPO.replace("https://", "")}
            </a>
          </span>
          <span>Bundled schemas</span>
          <span>{SCHEMA_LIST.map((s) => s.label).join(", ")}</span>
        </div>
        <p className="ctx-hint">
          Schema-aware editor for F5 AS3 per-application declarations, with
          NetBox integration and BIG-IP validation.
        </p>
        <div className="modal-actions">
          <button autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
