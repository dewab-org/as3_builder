import { useEffect, useState } from "react";
import type { JsonPath, PropertyInfo } from "../engine";

interface PropertyWidgetProps {
  prop: PropertyInfo;
  value: unknown;
  contextPath: JsonPath;
  onEdit: (path: JsonPath, value: unknown) => void;
  onNavigate: (path: JsonPath) => void;
}

function summarize(value: unknown): string {
  if (Array.isArray(value)) return `[…] ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object" && value !== null)
    return `{…} ${Object.keys(value).length} prop${Object.keys(value).length === 1 ? "" : "s"}`;
  return String(value);
}

export default function PropertyWidget({
  prop,
  value,
  contextPath,
  onEdit,
  onNavigate,
}: PropertyWidgetProps) {
  const propPath = [...contextPath, prop.name];
  const [draft, setDraft] = useState(typeof value === "string" ? value : "");
  const [patternError, setPatternError] = useState(false);

  useEffect(() => {
    if (typeof value === "string") setDraft(value);
  }, [value]);

  let control: React.ReactNode;

  if (typeof value === "object" && value !== null) {
    // Objects and arrays are edited in place in the text; offer navigation.
    control = (
      <span className="pw-summary">
        {summarize(value)}
        <button className="pw-goto" onClick={() => onNavigate(propPath)} title="Go to value">
          ⤷
        </button>
      </span>
    );
  } else if (prop.type === "enum" && prop.enumValues) {
    control = (
      <select
        value={String(value ?? "")}
        onChange={(e) => {
          const v = prop.enumValues!.find((ev) => String(ev) === e.target.value);
          onEdit(propPath, v ?? e.target.value);
        }}
      >
        {value === undefined && <option value="">(unset)</option>}
        {prop.enumValues.map((ev) => (
          <option key={String(ev)} value={String(ev)}>
            {String(ev)}
          </option>
        ))}
      </select>
    );
  } else if (prop.type === "boolean") {
    control = (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onEdit(propPath, e.target.checked)}
      />
    );
  } else if (prop.type === "integer" || prop.type === "number") {
    control = (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        min={prop.schema.minimum}
        max={prop.schema.maximum}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && e.target.value !== "") onEdit(propPath, n);
        }}
      />
    );
  } else {
    // Strings and anything else scalar.
    control = (
      <input
        type="text"
        className={patternError ? "pw-invalid" : ""}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const pattern = prop.schema.pattern;
          if (pattern) {
            try {
              setPatternError(!new RegExp(pattern).test(draft));
            } catch {
              setPatternError(false);
            }
          }
          if (draft !== value) onEdit(propPath, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <div className="pw-row" title={prop.description}>
      <span className={`pw-name${prop.required ? " required" : ""}`}>
        {prop.name}
      </span>
      {control}
      <button
        className="pw-delete"
        disabled={prop.required}
        title={prop.required ? "Required property" : "Remove property"}
        onClick={() => onEdit(propPath, undefined)}
      >
        ✕
      </button>
    </div>
  );
}
