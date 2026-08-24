import { useState } from "react";
import type { JsonPath } from "../engine";
import type { TmshEquivalency } from "../engine";
import { CHIP_MIME, f5DocUrl } from "./chips";

export interface ChipPayload {
  name: string;
  sourcePath: JsonPath;
  isClassObject?: boolean;
  className?: string;
}

export interface AddableDetail {
  type?: string;
  description?: string;
  behavior?: string;
  defaultValue?: unknown;
  enumValues?: (string | number)[];
  xrefClasses?: string[];
  required?: boolean;
  /** AS3 class whose official F5 schema-reference section documents this
   * item (the class itself for Add-object rows, the containing class for
   * property rows). */
  docClass?: string;
  /** Human-readable constraints from the schema (ranges, patterns, formats). */
  constraints?: string[];
  /** Union alternatives ("integer" OR "Firewall_Port_List reference"). */
  branches?: { type: string; summary?: string }[];
  allowedFields?: string[];
  tmsh?: TmshEquivalency;
  schemaReference?: string;
  /** Deployment blacklist: soft/review rules are shown and confirmed on add. */
  unsupported?: { mode: "hard" | "soft" | "review"; reason: string };
  /** "some variants unsupported: …" for classes with when-scoped rules. */
  unsupportedNote?: string;
}

export interface AddableItem {
  key: string;
  label: string;
  typeBadge?: string;
  required?: boolean;
  detail: AddableDetail;
  payload: ChipPayload;
}

export function DetailCard({
  label,
  detail,
}: {
  label: string;
  detail: AddableDetail;
}) {
  return (
    <div className="detail-card">
      <div className="detail-title">
        {label}
        {detail.type && <span className="detail-type">{detail.type}</span>}
        {detail.required && <span className="detail-required">required</span>}
      </div>
      {detail.unsupported && (
        <p
          className={`detail-unsupported${detail.unsupported.mode === "review" ? " review" : ""}`}
        >
          {detail.unsupported.mode === "review"
            ? "Requires review here"
            : `Unsupported here (${detail.unsupported.mode})`}
          : {detail.unsupported.reason}
        </p>
      )}
      {detail.unsupportedNote && (
        <p className="detail-unsupported">{detail.unsupportedNote}</p>
      )}
      {detail.description && (
        <p className="detail-desc">{detail.description}</p>
      )}
      {detail.behavior && detail.behavior !== detail.description && (
        <div className="detail-expanded">
          <span className="detail-kv-label">Behavior</span>
          <p className="detail-desc">{detail.behavior}</p>
        </div>
      )}
      {detail.defaultValue !== undefined && (
        <div className="detail-kv">
          <span>Default</span>
          <code>{JSON.stringify(detail.defaultValue)}</code>
        </div>
      )}
      {detail.constraints && detail.constraints.length > 0 && (
        <div className="detail-kv">
          <span>Rules</span>
          <span className="detail-enum">
            {detail.constraints.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </span>
        </div>
      )}
      {detail.branches && detail.branches.length > 0 && (
        <div className="detail-branches">
          <span className="detail-kv-label">Accepts one of</span>
          {detail.branches.map((b, i) => (
            <div key={i} className="detail-branch">
              <code>{b.type}</code>
              {b.summary && <span>{b.summary}</span>}
            </div>
          ))}
        </div>
      )}
      {detail.enumValues && detail.enumValues.length > 0 && (
        <div className="detail-kv">
          <span>Values</span>
          <span className="detail-enum">
            {detail.enumValues.map((v) => (
              <code key={String(v)}>{String(v)}</code>
            ))}
          </span>
        </div>
      )}
      {detail.xrefClasses && detail.xrefClasses.length > 0 && (
        <div className="detail-kv">
          <span>References</span>
          <span className="detail-enum">
            {detail.xrefClasses.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </span>
        </div>
      )}
      {detail.allowedFields && detail.allowedFields.length > 0 && (
        <div className="detail-kv">
          <span>Allowed fields</span>
          <span className="detail-enum">
            {detail.allowedFields.map((field) => (
              <code key={field}>{field}</code>
            ))}
          </span>
        </div>
      )}
      {detail.tmsh && (
        <div className="detail-expanded">
          <span className="detail-kv-label">TMOS / tmsh equivalency</span>
          <p className="detail-desc">
            <code>
              {Array.isArray(detail.tmsh.objectType)
                ? detail.tmsh.objectType.join(" | ")
                : detail.tmsh.objectType}
            </code>
            {detail.tmsh.property && (
              <> property <code>{detail.tmsh.property}</code></>
            )}
          </p>
          {detail.tmsh.inspectionCommand && (
            <code>{detail.tmsh.inspectionCommand}</code>
          )}
          {detail.tmsh.reference && !Array.isArray(detail.tmsh.reference) && (
            <p className="detail-doclink">
              <a
                href={detail.tmsh.reference}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                F5 tmsh reference ↗
              </a>
            </p>
          )}
        </div>
      )}
      {detail.docClass && (
        <div className="detail-doclink">
          <a
            href={detail.schemaReference ?? f5DocUrl(detail.docClass)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            F5 schema reference: {detail.docClass} ↗
          </a>
        </div>
      )}
    </div>
  );
}

interface AddableListProps {
  items: AddableItem[];
  onAdd: (payload: ChipPayload) => void;
}

export default function AddableList({ items, onAdd }: AddableListProps) {
  const [hovered, setHovered] = useState<{
    key: string;
    top: number;
    left: number;
  } | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const shown = filter
    ? items.filter((i) =>
        i.label.toLowerCase().includes(filter.trim().toLowerCase())
      )
    : items;

  const hoveredItem = hovered
    ? shown.find((i) => i.key === hovered.key)
    : undefined;

  return (
    <div className="addable-list">
      <input
        type="search"
        className="addable-filter"
        placeholder={`Filter ${items.length}…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {shown.length === 0 && (
        <div className="addable-empty">No matches for “{filter}”</div>
      )}
      {shown.map((item) => (
        <div key={item.key}>
          <div
            className={`addable-row${item.required ? " required" : ""}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(CHIP_MIME, JSON.stringify(item.payload));
              e.dataTransfer.effectAllowed = "copy";
              setHovered(null);
            }}
            onDoubleClick={() => onAdd(item.payload)}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHovered({
                key: item.key,
                top: rect.top,
                left: rect.left,
              });
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="addable-drag">⠿</span>
            <span className="addable-name">
              {item.required && <span className="chip-dot" />}
              {item.label}
            </span>
            {item.typeBadge && (
              <span className="addable-type">{item.typeBadge}</span>
            )}
            {item.detail.unsupported && (
              <span
                className={`addable-unsupported${item.detail.unsupported.mode === "review" ? " review" : ""}`}
                title={item.detail.unsupported.reason}
              >
                {item.detail.unsupported.mode === "review"
                  ? "review"
                  : "unsupported"}
              </span>
            )}
            {!item.detail.unsupported && item.detail.unsupportedNote && (
              <span
                className="addable-unsupported variant"
                title={item.detail.unsupportedNote}
              >
                !
              </span>
            )}
            <button
              className="addable-btn"
              title={`Add ${item.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(item.payload);
              }}
            >
              +
            </button>
            <button
              className={`addable-btn${pinnedKey === item.key ? " active" : ""}`}
              title="Details"
              onClick={(e) => {
                e.stopPropagation();
                setPinnedKey(pinnedKey === item.key ? null : item.key);
              }}
            >
              ⓘ
            </button>
          </div>
          {pinnedKey === item.key && (
            <DetailCard label={item.label} detail={item.detail} />
          )}
        </div>
      ))}
      {hoveredItem && hovered && pinnedKey !== hoveredItem.key && (
        <div
          className="detail-tooltip"
          style={{
            top: Math.min(hovered.top, window.innerHeight - 220),
            right: window.innerWidth - hovered.left + 8,
          }}
        >
          <DetailCard label={hoveredItem.label} detail={hoveredItem.detail} />
        </div>
      )}
    </div>
  );
}
