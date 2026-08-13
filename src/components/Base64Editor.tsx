import { useEffect, useState } from "react";
import {
  decodeBase64Safely,
  encodeBase64,
  type Base64Wrapper,
} from "../engine";

interface Base64EditorProps {
  wrapper: Base64Wrapper;
  /** Receives the full replacement value (base64 re-encoded). */
  onCommit: (value: Base64Wrapper) => void;
  onClose?: () => void;
  /** Compact rendering for inline use in the simplified view. */
  compact?: boolean;
}

// Cleartext window over a {"base64": …} value. The document keeps the encoded
// form at all times — this only decodes for display and re-encodes on save.
export default function Base64Editor({
  wrapper,
  onCommit,
  onClose,
  compact,
}: Base64EditorProps) {
  const decoded = decodeBase64Safely(wrapper.base64);
  const [draft, setDraft] = useState(decoded.text);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(decodeBase64Safely(wrapper.base64).text);
    setDirty(false);
  }, [wrapper.base64]);

  const save = () => {
    onCommit({ ...wrapper, base64: encodeBase64(draft) });
    setDirty(false);
    onClose?.();
  };

  return (
    <div className={`b64-panel${compact ? " compact" : ""}`}>
      <div className="b64-head">
        <span className="b64-badge">base64</span>
        <span className="b64-note">
          shown decoded — re-encoded on save
          {decoded.error ? ` · ${decoded.error}` : ""}
        </span>
        <span className="b64-size">
          {draft.length} chars · {wrapper.base64.length} encoded
        </span>
      </div>
      <textarea
        className="b64-text"
        rows={compact ? 6 : 10}
        spellCheck={false}
        readOnly={!decoded.isText}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose?.();
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (dirty) save();
          }
        }}
      />
      <div className="b64-actions">
        {onClose && <button onClick={onClose}>Close</button>}
        <button className="primary" disabled={!dirty || !decoded.isText} onClick={save}>
          {dirty ? "Save (re-encode)" : "Saved"}
        </button>
      </div>
    </div>
  );
}
