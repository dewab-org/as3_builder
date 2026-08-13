/** Drag-and-drop payload type and schema doc links.
 *
 * These live apart from AddableList so that file exports only components —
 * a module mixing the two breaks React Fast Refresh, which then reloads the
 * whole app (losing editor state) on every edit to it. */

/** MIME type for a property dragged from the picker into the editor. */
export const CHIP_MIME = "application/x-as3-prop";

/** Per-class page in the official F5 AS3 schema reference. */
export function f5DocUrl(className: string): string {
  return `https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/refguide/schemaref/${encodeURIComponent(className)}.schema.json.html`;
}
