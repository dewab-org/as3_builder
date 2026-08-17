import { useEffect, useRef, useState } from "react";

interface ConfirmButtonProps {
  className?: string;
  title: string;
  /** Label shown while armed (default "confirm?"). */
  armedLabel?: string;
  onConfirm: () => void;
  children: React.ReactNode;
}

// Two-step delete: first click arms the button (turns red, shows the armed
// label), second click within 2.5s confirms. Avoids native confirm() popups.
export default function ConfirmButton({
  className,
  title,
  armedLabel = "confirm?",
  onConfirm,
  children,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      className={`${className ?? ""}${armed ? " armed" : ""}`}
      title={armed ? "Click again to confirm" : title}
      // Children are usually a glyph (✕, 🗑), which would otherwise be the
      // whole accessible name.
      aria-label={armed ? `${title} — click again to confirm` : title}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 5000);
        }
      }}
    >
      {armed ? armedLabel : children}
    </button>
  );
}
