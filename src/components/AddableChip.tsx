import type { JsonPath } from "../engine";

export interface ChipPayload {
  name: string;
  sourcePath: JsonPath;
  isClassObject?: boolean;
  className?: string;
}

export const CHIP_MIME = "application/x-as3-prop";

interface AddableChipProps {
  label: string;
  typeBadge?: string;
  description?: string;
  required?: boolean;
  payload: ChipPayload;
  onAdd: (payload: ChipPayload) => void;
}

export default function AddableChip({
  label,
  typeBadge,
  description,
  required,
  payload,
  onAdd,
}: AddableChipProps) {
  return (
    <div
      className={`chip${required ? " required" : ""}`}
      draggable
      title={description}
      onDragStart={(e) => {
        e.dataTransfer.setData(CHIP_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={() => onAdd(payload)}
    >
      {required && <span className="chip-dot" />}
      <span className="chip-name">{label}</span>
      {typeBadge && <span className="chip-type">{typeBadge}</span>}
    </div>
  );
}
