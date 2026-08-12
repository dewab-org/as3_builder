import { useEffect, useState } from "react";
import type { JsonPath, PropertyInfo } from "../engine";
import { validateValue } from "../engine";

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
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (typeof value === "string") {
      setDraft(value);
      setError(validateValue(prop.schema, value).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const numError =
    (prop.type === "integer" || prop.type === "number") &&
    typeof value === "number"
      ? validateValue(prop.schema, value).message
      : undefined;
  const shownError =
    prop.type === "integer" || prop.type === "number" ? numError : error;

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
      <select
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(e) => onEdit(propPath, e.target.value === "true")}
      >
        {value === undefined && <option value="">(unset)</option>}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  } else if (prop.type === "integer" || prop.type === "number") {
    control = (
      <input
        type="number"
        className={numError ? "pw-invalid" : ""}
        title={numError}
        value={typeof value === "number" ? value : ""}
        min={prop.schema.minimum}
        max={prop.schema.maximum}
        step={prop.type === "integer" ? 1 : undefined}
        onChange={(e) => {
          if (e.target.value === "") return;
          const n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          onEdit(propPath, prop.type === "integer" ? Math.trunc(n) : n);
        }}
      />
    );
  } else {
    // Strings and anything else scalar: live-validate against pattern,
    // format (f5ip, hostname, …), and length constraints.
    control = (
      <input
        type="text"
        className={error ? "pw-invalid" : ""}
        title={error}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(validateValue(prop.schema, e.target.value).message);
        }}
        onBlur={() => {
          if (draft !== value) onEdit(propPath, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <div className="pw-wrap">
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
      {shownError && <div className="pw-error">{shownError}</div>}
    </div>
  );
}
