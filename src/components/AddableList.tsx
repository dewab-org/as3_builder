import { useState } from "react";
import type { JsonPath } from "../engine";

export interface ChipPayload {
  name: string;
  sourcePath: JsonPath;
  isClassObject?: boolean;
  className?: string;
}

export const CHIP_MIME = "application/x-as3-prop";

export interface AddableDetail {
  type?: string;
  description?: string;
  defaultValue?: unknown;
  enumValues?: (string | number)[];
  xrefClasses?: string[];
  required?: boolean;
}

export interface AddableItem {
  key: string;
  label: string;
  typeBadge?: string;
  required?: boolean;
  detail: AddableDetail;
  payload: ChipPayload;
}

function DetailCard({ label, detail }: { label: string; detail: AddableDetail }) {
  return (
    <div className="detail-card">
      <div className="detail-title">
        {label}
        {detail.type && <span className="detail-type">{detail.type}</span>}
        {detail.required && <span className="detail-required">required</span>}
      </div>
      {detail.description && (
        <p className="detail-desc">{detail.description}</p>
      )}
      {detail.defaultValue !== undefined && (
        <div className="detail-kv">
          <span>Default</span>
          <code>{JSON.stringify(detail.defaultValue)}</code>
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

  const hoveredItem = hovered
    ? items.find((i) => i.key === hovered.key)
    : undefined;

  return (
    <div className="addable-list">
      {items.map((item) => (
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
