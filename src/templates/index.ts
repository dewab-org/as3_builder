import empty from "./empty.json";
import httpApp from "./http-app.json";
import httpsApp from "./https-app.json";

export interface TemplateEntry {
  id: string;
  label: string;
  content: string; // pretty-printed JSON text
}

function toText(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export const TEMPLATES: TemplateEntry[] = [
  { id: "empty", label: "Empty declaration", content: toText(empty) },
  { id: "http-app", label: "HTTP app + pool", content: toText(httpApp) },
  { id: "https-app", label: "HTTPS app + TLS + pool", content: toText(httpsApp) },
];

export function getTemplate(id: string): TemplateEntry {
  const entry = TEMPLATES.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown template id: ${id}`);
  return entry;
}
