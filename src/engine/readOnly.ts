/**
 * AS3 classes that exist in a declaration but cannot be written back to
 * NetBox, because NetBox is not where they live.
 *
 * These are not "not implemented yet" — they are immutable from this context
 * by design, and the editor marks them so an edit that can never be pushed is
 * obvious before it is made. Editing is still allowed: a declaration can be
 * applied straight to a BIG-IP, where the material does matter.
 */
export const READ_ONLY_CLASSES: Record<string, string> = {
  // NetBox stores certificate metadata; the material lives in the certificate
  // estate (Venafi / the BIG-IP).
  Certificate: "NetBox stores a pointer only — the material lives in the certificate estate",
  // Pre-created estate objects. A declaration consumes one; the link is
  // writable, the pool itself is not.
  SNAT_Pool: "SNAT pools are pre-created estate objects — a declaration only points at one",
  SNAT_Translation: "SNAT translations are pre-created estate objects",
};

export function isReadOnlyClass(className: unknown): className is string {
  return typeof className === "string" && className in READ_ONLY_CLASSES;
}

/** Why the class is read-only, for tooltips and notes. */
export function readOnlyReason(className: unknown): string | undefined {
  return isReadOnlyClass(className) ? READ_ONLY_CLASSES[className] : undefined;
}
