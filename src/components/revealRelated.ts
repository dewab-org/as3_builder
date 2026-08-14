/**
 * Bring a highlighted element into view — but only when nothing highlighted is
 * already visible. Selecting a reference should not yank the pane around when
 * the linked object is right there, and when several pointers light up, one
 * of them being on screen is enough.
 */
export function revealRelated(root: ParentNode | null, selector: string): void {
  if (!root) return;
  const targets = [...root.querySelectorAll(selector)];
  if (targets.length === 0) return;
  const visible = targets.some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  if (visible) return;
  targets[0].scrollIntoView({ block: "center", behavior: "smooth" });
}
