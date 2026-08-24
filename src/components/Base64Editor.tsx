import { useEffect, useState, type ComponentType } from "react";
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
  /** Monaco language id for the DECODED text (e.g. "tcl" for iRules). When
   * set, the editor upgrades to Monaco with highlighting once its chunk has
   * loaded; the plain textarea below is the fallback until then — and in
   * environments where Monaco cannot run at all, it simply remains. */
  language?: string;
}

type MonacoEditorComponent = ComponentType<{
  height: string;
  language: string;
  theme: string;
  value: string;
  options: Record<string, unknown>;
  onChange: (value: string | undefined) => void;
}>;

// One load for every Base64Editor instance; Monaco is already a lazy chunk
// (the JSON view does the same), so this costs nothing until a highlighted
// editor is actually opened.
let monacoEditorPromise: Promise<MonacoEditorComponent> | null = null;
function loadMonacoEditor(): Promise<MonacoEditorComponent> {
  monacoEditorPromise ??= (async () => {
    await import("../monacoSetup");
    const mod = await import("@monaco-editor/react");
    return mod.default as unknown as MonacoEditorComponent;
  })();
  return monacoEditorPromise;
}

// Cleartext window over a {"base64": …} value. The document keeps the encoded
// form at all times — this only decodes for display and re-encodes on save.
export default function Base64Editor({
  wrapper,
  onCommit,
  onClose,
  compact,
  language,
}: Base64EditorProps) {
  const decoded = decodeBase64Safely(wrapper.base64);
  const [draft, setDraft] = useState(decoded.text);
  const [dirty, setDirty] = useState(false);
  const [MonacoEditor, setMonacoEditor] =
    useState<MonacoEditorComponent | null>(null);

  useEffect(() => {
    if (!language) return;
    let active = true;
    loadMonacoEditor().then(
      (component) => {
        // A function value would be *called* by the state setter.
        if (active) setMonacoEditor(() => component);
      },
      () => {
        // Monaco unavailable (test DOMs, exotic hosts): the textarea stays.
      }
    );
    return () => {
      active = false;
    };
  }, [language]);

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
        {language && (
          <span className="b64-badge lang">{language}</span>
        )}
        <span className="b64-note">
          shown decoded — re-encoded on save
          {decoded.error ? ` · ${decoded.error}` : ""}
        </span>
        <span className="b64-size">
          {draft.length} chars · {wrapper.base64.length} encoded
        </span>
      </div>
      {language && MonacoEditor && decoded.isText ? (
        <div className="b64-monaco">
          <MonacoEditor
            height={compact ? "220px" : "340px"}
            language={language}
            theme={
              document.documentElement.dataset.theme === "dark"
                ? "vs-dark"
                : "light"
            }
            value={draft}
            options={{
              minimap: { enabled: false },
              lineNumbers: "on",
              tabSize: 4,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "off",
            }}
            onChange={(next) => {
              setDraft(next ?? "");
              setDirty(true);
            }}
          />
        </div>
      ) : (
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
      )}
      <div className="b64-actions">
        {onClose && <button onClick={onClose}>Close</button>}
        <button className="primary" disabled={!dirty || !decoded.isText} onClick={save}>
          {dirty ? "Save (re-encode)" : "Saved"}
        </button>
      </div>
    </div>
  );
}
