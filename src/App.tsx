import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { editor } from "monaco-editor";
import { findNodeAtLocation, getLocation, parse, parseTree } from "jsonc-parser";
import Toolbar from "./components/Toolbar";
import BigipDialog from "./components/BigipDialog";
import BigipLoadDialog from "./components/BigipLoadDialog";
import NetboxDialog from "./components/NetboxDialog";
import PushNetboxDialog from "./components/PushNetboxDialog";
// Monaco is ~4MB of the bundle and the simplified view is the default, so the
// editor is fetched the first time someone opens the JSON view. Once opened it
// stays mounted (hidden), keeping its own undo stack and scroll position.
const EditorPane = lazy(() => import("./components/EditorPane"));
import TreePane from "./components/TreePane";
import ContextPanel from "./components/ContextPanel";
import SimplifiedPane from "./components/SimplifiedPane";
import type { ChipPayload } from "./components/AddableList";
import {
  DEFAULT_SCHEMA_ENTRY,
  DEFAULT_SCHEMA_ID,
  loadSchema,
  urlSchemaId,
  urlSchemaLabel,
  type SchemaEntry,
} from "./schemas";
import { getTemplate } from "./templates";
import { useDocument } from "./hooks/useDocument";
import { netboxSession } from "./netboxSession";
import { loadAppConfig } from "./appConfig";
import { DEFAULT_POLICY, type SupportPolicy } from "./engine/supportPolicy";
import HoverCard, { type HoverAnchor } from "./components/HoverCard";
import { applyBigipDefaults } from "./components/bigipSession";
import { useValidation } from "./hooks/useValidation";
import {
  applicationMemberClasses,
  bigipCandidates,
  buildClassRegistry,
  computeUpdates,
  effectiveSchema,
  extractXrefClasses,
  extrasFromAs3,
  getAtPath,
  indexClassInstances,
  getContext,
  isPlainObject,
  loadAs3Documentation,
  loadBigipCatalog,
  resolveDrop,
  resolveSchemaForPath,
  relatedPaths,
  searchMatches,
  stubValue,
  summarizeEntry,
  xrefCandidatesAt,
  type BigipCatalog,
  type DocumentationIndex,
  type DropPayload,
  type JsonPath,
  type JsonSchemaRoot,
} from "./engine";

const INITIAL_TEXT = getTemplate("http-app").content;

// Deep link contract (used by the future "Edit in AS3 Builder" callout in the
// netbox-load-balancer plugin — see NETBOX-DEEPLINK-PLAN.md):
//   ?netbox=<origin>          NetBox base URL; opens the Load dialog prefilled
//   &app=<id>                 application id to load once connected
//   &object=<endpoint>:<id>   jump to the object after loading (via manifest)
//   &focus=<field>            highlight; "extra_parameters" flashes the props
//                             that map to the NetBox extras field
interface DeepLink {
  netbox: string;
  appId?: string;
  object?: { endpoint: string; id: number };
  focus?: string;
}

function parseDeepLink(): DeepLink | null {
  const params = new URLSearchParams(window.location.search);
  const netbox = params.get("netbox");
  if (!netbox) return null;
  let object: DeepLink["object"];
  const objectParam = params.get("object");
  if (objectParam) {
    const m = /^([a-z-]+):(\d+)$/.exec(objectParam);
    if (m) object = { endpoint: m[1], id: Number(m[2]) };
  }
  return {
    netbox,
    appId: params.get("app") ?? undefined,
    object,
    focus: params.get("focus") ?? undefined,
  };
}

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const stored = localStorage.getItem("as3b-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function monacoRangeFor(
  model: editor.ITextModel,
  offset: number,
  length: number
) {
  const start = model.getPositionAt(offset);
  const end = model.getPositionAt(offset + length);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

export default function App() {
  const [schemaId, setSchemaId] = useState(DEFAULT_SCHEMA_ID);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [baselineText, setBaselineText] = useState(INITIAL_TEXT);
  const [showBigipDialog, setShowBigipDialog] = useState(false);
  const [showNetboxDialog, setShowNetboxDialog] = useState(false);
  const [showBigipLoadDialog, setShowBigipLoadDialog] = useState(false);
  const deepLinkRef = useRef<DeepLink | null>(null);

  // Deep link: prefill the NetBox connection and open the Load dialog.
  useEffect(() => {
    const link = parseDeepLink();
    if (!link) return;
    deepLinkRef.current = link;
    netboxSession.url = link.netbox;
    setShowNetboxDialog(true);
  }, []);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [viewMode, setViewMode] = useState<"json" | "simple">("simple");
  // Sticky: once the editor has been loaded, keep it mounted so toggling back
  // does not throw away its undo stack, folds and scroll position.
  const [jsonEverOpened, setJsonEverOpened] = useState(viewMode === "json");
  useEffect(() => {
    if (viewMode === "json") setJsonEverOpened(true);
  }, [viewMode]);
  // URL-sourced schemas ({id, label}); URLs persist across sessions.
  const [urlSchemas, setUrlSchemas] = useState<{ id: string; label: string }[]>(
    () => {
      try {
        const stored = JSON.parse(
          localStorage.getItem("as3b-url-schemas") ?? "[]"
        ) as string[];
        return stored.map((u) => ({ id: urlSchemaId(u), label: urlSchemaLabel(u) }));
      } catch {
        return [];
      }
    }
  );
  const [schemaUrlDialog, setSchemaUrlDialog] = useState<{
    url: string;
    busy: boolean;
    error?: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modifiedDecosRef = useRef<editor.IEditorDecorationsCollection | null>(
    null
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("as3b-theme", theme);
  }, [theme]);

  const docState = useDocument(INITIAL_TEXT);
  const {
    text,
    setText,
    debouncedText,
    lastGoodDoc,
    isStale,
    applyEdit,
    applyEditMany,
    replaceText,
    undo,
    redo,
    canUndo,
    canRedo,
  } = docState;

  // ⌘/Ctrl+Z anywhere except inside Monaco, which has its own stack and
  // handles the shortcut itself. Skipped while typing in a field so text
  // inputs keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (
        el?.closest(".monaco-editor") ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      )
        return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);


  // Full AS3 schemas are code-split; keep the previous schema active while
  // the newly selected one loads.
  const [schemaEntry, setSchemaEntry] = useState<SchemaEntry>(
    DEFAULT_SCHEMA_ENTRY
  );
  useEffect(() => {
    let cancelled = false;
    loadSchema(schemaId)
      .then((entry) => {
        if (!cancelled) setSchemaEntry(entry);
      })
      .catch(() => {
        if (!cancelled) flashToast(`Failed to load schema ${schemaId}`);
      });
    return () => {
      cancelled = true;
    };
  }, [schemaId, flashToast]);
  const root = schemaEntry.schema as JsonSchemaRoot;
  const registry = useMemo(() => buildClassRegistry(root), [root]);
  const memberClasses = useMemo(
    () => applicationMemberClasses(root, registry),
    [root, registry]
  );

  const context = useMemo(
    () => getContext(root, registry, debouncedText, cursorOffset),
    [root, registry, debouncedText, cursorOffset]
  );

  // Startup defaults from the server's environment (.env / env vars / flags).
  // They only prefill the dialogs; nothing is stored.
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);
  // Deployment policy: which features exist here. Defaults to everything
  // until /app-config answers, so a slow fetch never hides working buttons
  // from an unrestricted deployment.
  const [policy, setPolicy] = useState<SupportPolicy>(DEFAULT_POLICY);
  useEffect(() => {
    void loadAppConfig().then((config) => {
      setConfigWarnings(config.warnings);
      setPolicy(config.policy);
      if (!config.policy.netbox && deepLinkRef.current) {
        console.warn(
          "NetBox deep link ignored: NetBox support is disabled by this deployment's configuration."
        );
        deepLinkRef.current = null;
        setShowNetboxDialog(false);
      }
      if (config.netbox.url) netboxSession.url = config.netbox.url;
      netboxSession.username ||= config.netbox.username;
      netboxSession.password ||= config.netbox.password;
      netboxSession.token ||= config.netbox.token;
      netboxSession.validateCert = config.netbox.validateCert;
      applyBigipDefaults(config.bigip);
    });
  }, []);

  // Find-in-document: one query, both panes. Matches include their ancestors
  // so the route to a hit stays visible while everything else dims.
  const [searchQuery, setSearchQuery] = useState("");
  const searchKeys = useMemo(
    () => searchMatches(lastGoodDoc, searchQuery),
    [lastGoodDoc, searchQuery]
  );

  // What a push would do, computed from the live document so the count is
  // visible before the dialog is opened. Pure and cheap; the same function the
  // dialog runs. Absent until an application has been loaded from NetBox.
  const pushPreview = useMemo(() => {
    if (!policy.netbox) return undefined;
    const manifest = netboxSession.manifests.get(
      String((lastGoodDoc as Record<string, unknown> | undefined)?.id ?? "")
    );
    if (!manifest || !isPlainObject(lastGoodDoc)) return undefined;
    const changeSet = computeUpdates(lastGoodDoc as Record<string, unknown>, manifest);
    const writes =
      changeSet.updates.reduce(
        (n, u) => n + u.changes.length + u.ops.length,
        0
      ) +
      changeSet.creates.length +
      changeSet.deletes.length;
    return { writes, notes: changeSet.notes.length };
  }, [lastGoodDoc, policy.netbox]);

  // Both ends of the reference under the cursor: what it points at, and what
  // points at it. The tree and the simplified view highlight the same set.
  const relatedKeys = useMemo(
    () => relatedPaths(lastGoodDoc, context.path),
    [lastGoodDoc, context.path]
  );

  // Estate objects (/Common profiles, monitors, persistence) a pointer can
  // name. Loaded once; absent until someone runs the fetch script.
  const [bigipCatalog, setBigipCatalog] = useState<BigipCatalog>();
  useEffect(() => {
    let active = true;
    void loadBigipCatalog().then((c) => {
      if (active) setBigipCatalog(c);
    });
    return () => {
      active = false;
    };
  }, []);

  // What the pointer is over, in either view. Drives the info pane's hover
  // preview; the cursor-driven context underneath is left alone.
  const [hoverAnchor, setHoverAnchor] = useState<HoverAnchor | null>(null);
  // Leaving a row does not close the card immediately: there is a gap between
  // the pointer and the card, and closing mid-crossing would make the links
  // unreachable. Entering the card cancels the close; leaving it closes now.
  const hoverCloseTimer = useRef<number | undefined>(undefined);
  const cancelHoverClose = useCallback(() => {
    window.clearTimeout(hoverCloseTimer.current);
  }, []);
  // Pinned: the card stops following the pointer so it can be read (and
  // scrolled, and its links followed) without the next hover replacing it.
  const [hoverPinned, setHoverPinned] = useState(false);
  const setHover = useCallback(
    (anchor: HoverAnchor | null) => {
      if (hoverPinned) return;
      cancelHoverClose();
      if (anchor) setHoverAnchor(anchor);
      else
        hoverCloseTimer.current = window.setTimeout(
          () => setHoverAnchor(null),
          220
        );
    },
    [cancelHoverClose, hoverPinned]
  );
  const closeHoverNow = useCallback(() => {
    if (hoverPinned) return;
    cancelHoverClose();
    setHoverAnchor(null);
  }, [cancelHoverClose, hoverPinned]);
  const unpinHover = useCallback(() => {
    setHoverPinned(false);
    cancelHoverClose();
    setHoverAnchor(null);
  }, [cancelHoverClose]);

  // A pinned card is dismissed by Escape or by clicking anywhere else — the
  // same two exits every other transient surface in the app uses.
  useEffect(() => {
    if (!hoverPinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") unpinHover();
    };
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest(".hover-card")) unpinHover();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [hoverPinned, unpinHover]);
  // The generated F5 docs index: one load, shared by the info pane and the
  // floating hover card.
  const [documentation, setDocumentation] = useState<DocumentationIndex>();
  useEffect(() => {
    let active = true;
    void loadAs3Documentation().then((index) => {
      if (active) setDocumentation(index);
    });
    return () => {
      active = false;
    };
  }, []);
  // Resolve against the live text, not debouncedText: the offset comes from
  // Monaco's current model, so during the parse debounce the two disagree and
  // the preview would describe the wrong node.
  const hoverOffsetToPath = useCallback(
    (offset: number | null, x?: number, y?: number) => {
      if (offset === null || x === undefined || y === undefined)
        return setHover(null);
      const path = getLocation(text, offset).path as JsonPath;
      setHover(path.length > 0 ? { path, x, y } : null);
    },
    [text, setHover]
  );

  // Baseline = the document as loaded/saved; anything differing from it is
  // "modified" and highlighted in the tree and the editor margin.
  const baselineDoc = useMemo(
    () => parse(baselineText, [], { allowTrailingComma: true }) as unknown,
    [baselineText]
  );

  const isModifiedPath = useCallback(
    (path: JsonPath): boolean => {
      if (lastGoodDoc === undefined) return false;
      return (
        JSON.stringify(getAtPath(lastGoodDoc, path)) !==
        JSON.stringify(getAtPath(baselineDoc, path))
      );
    },
    [lastGoodDoc, baselineDoc]
  );

  // Yellow margin stripes on application members that differ from baseline.
  useEffect(() => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model || model.getValue() !== debouncedText) return;
    const tree = parseTree(debouncedText, [], { allowTrailingComma: true });
    if (!tree || !isPlainObject(lastGoodDoc)) return;
    const decos: editor.IModelDeltaDecoration[] = [];
    for (const [appKey, appVal] of Object.entries(lastGoodDoc)) {
      if (!isPlainObject(appVal)) continue;
      for (const memberKey of Object.keys(appVal)) {
        const path: JsonPath = [appKey, memberKey];
        if (!isModifiedPath(path)) continue;
        const node = findNodeAtLocation(tree, path);
        const propNode = node?.parent ?? node;
        if (!propNode) continue;
        decos.push({
          range: monacoRangeFor(model, propNode.offset, propNode.length),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: "modified-stripe",
          },
        });
      }
    }
    modifiedDecosRef.current?.clear();
    modifiedDecosRef.current = ed.createDecorationsCollection(decos);
  }, [debouncedText, lastGoodDoc, isModifiedPath]);

  function loadText(newText: string) {
    replaceText(newText);
    setBaselineText(newText);
    setCursorOffset(0);
  }

  // Replacing a document with unsaved edits asks first — through a real
  // dialog, not window.confirm, which some embedded browsers swallow
  // silently (the load then just... does not happen, with no clue why).
  const [pendingLoad, setPendingLoad] = useState<{
    text: string;
    source: string;
    andThen?: () => void;
  } | null>(null);

  function guardedLoad(newText: string, source: string, andThen?: () => void) {
    if (text === baselineText) {
      loadText(newText);
      andThen?.();
    } else {
      setPendingLoad({ text: newText, source, andThen });
    }
  }

  // What the replace would discard, named concretely: edited application
  // members count for more than "unsaved changes".
  const modifiedMemberCount = useMemo(() => {
    if (!isPlainObject(lastGoodDoc)) return 0;
    let count = 0;
    for (const [appKey, appVal] of Object.entries(lastGoodDoc)) {
      if (!isPlainObject(appVal)) continue;
      for (const memberKey of Object.keys(appVal)) {
        if (isModifiedPath([appKey, memberKey])) count++;
      }
    }
    return count;
  }, [lastGoodDoc, isModifiedPath]);

  // Move the Monaco cursor to the value at `path`. Strings land BETWEEN the
  // quotes so typing replaces/fills the value; objects/arrays land just
  // inside the bracket. With `flash`, the value briefly highlights so the
  // user sees where input is expected.
  const navigateToPath = useCallback(
    (path: JsonPath, opts?: { flash?: boolean; flashChildren?: string[] }) => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (!ed || !model) return;
      const tree = parseTree(model.getValue(), [], {
        allowTrailingComma: true,
      });
      if (!tree) return;
      const node = path.length === 0 ? tree : findNodeAtLocation(tree, path);
      if (!node) return;
      const inside =
        node.type === "object" || node.type === "array" || node.type === "string"
          ? node.offset + 1
          : node.offset;
      const pos = model.getPositionAt(inside);
      ed.setPosition(pos);
      ed.revealPositionInCenterIfOutsideViewport(pos);
      ed.focus();
      setCursorOffset(inside);
      // Highlight where input is expected: specific child property values
      // (flashChildren) or the whole navigated value (flash).
      const flashNodes =
        opts?.flashChildren && opts.flashChildren.length > 0
          ? opts.flashChildren
              .map((name) => findNodeAtLocation(tree, [...path, name]))
              .filter((n): n is NonNullable<typeof n> => n !== undefined)
          : opts?.flash
            ? [node]
            : [];
      if (flashNodes.length > 0) {
        const deco = ed.createDecorationsCollection(
          flashNodes.map((n) => ({
            range: monacoRangeFor(model, n.offset, n.length),
            options: { className: "inserted-flash" },
          }))
        );
        setTimeout(() => deco.clear(), 2500);
      }
    },
    []
  );

  // When the offset sits inside a VALUE whose schema offers a closed set of
  // choices (enum, boolean, const), return the offset at the START of that
  // value (inside the quote for strings) — clicking there should pop the
  // full suggestion list so the user can pick instead of type. Returns null
  // for free-form values.
  const choiceValueStartAt = useCallback(
    (editorText: string, offset: number): number | null => {
      const loc = getLocation(editorText, offset);
      if (loc.isAtPropertyKey || loc.path.length === 0) return null;
      const node = loc.previousNode;
      if (!node) return null;
      if (offset < node.offset || offset > node.offset + node.length)
        return null;
      const doc = parse(editorText, [], { allowTrailingComma: true }) as unknown;
      const path = loc.path as JsonPath;
      const schema = resolveSchemaForPath(root, registry, doc, path);
      if (!schema) return null;
      try {
        // Pass the current value: conditional branches (if/then) carry the
        // enum for properties like addressDiscovery.
        const eff = effectiveSchema(root, schema, getAtPath(doc, path));
        const isChoice =
          (eff.enum?.length ?? 0) > 0 ||
          eff.const !== undefined ||
          eff.type === "boolean";
        if (!isChoice) return null;
        return node.type === "string" ? node.offset + 1 : node.offset;
      } catch {
        return null;
      }
    },
    [root, registry]
  );

  const handleEdit = useCallback(
    (path: JsonPath, value: unknown) => {
      applyEdit(path, value);
    },
    [applyEdit]
  );

  const submitSchemaUrl = useCallback(async () => {
    if (!schemaUrlDialog || schemaUrlDialog.busy) return;
    const url = schemaUrlDialog.url.trim();
    if (!url) return;
    setSchemaUrlDialog({ url, busy: true });
    try {
      const id = urlSchemaId(url);
      await loadSchema(id); // fetch + shape validation (cached on success)
      setUrlSchemas((prev) => {
        if (prev.some((s) => s.id === id)) return prev;
        const next = [...prev, { id, label: urlSchemaLabel(url) }];
        localStorage.setItem(
          "as3b-url-schemas",
          JSON.stringify(next.map((s) => s.id.slice(4)))
        );
        return next;
      });
      setSchemaId(id);
      setSchemaUrlDialog(null);
    } catch (err) {
      setSchemaUrlDialog({
        url,
        busy: false,
        error: String(err instanceof Error ? err.message : err),
      });
    }
  }, [schemaUrlDialog]);

  const { issues, ready: validatorReady } = useValidation(
    schemaEntry.schema,
    schemaEntry.id,
    lastGoodDoc
  );

  // Which inline editor fits the value at this path (simplified view).
  const getInlineSpec = useCallback(
    (path: JsonPath, value: unknown) => {
      const fallback = {
        kind: (typeof value === "number"
          ? "number"
          : typeof value === "boolean"
            ? "boolean"
            : "string") as "number" | "boolean" | "string",
      };
      const schema = resolveSchemaForPath(root, registry, lastGoodDoc, path);
      if (!schema) return fallback;
      let eff;
      try {
        eff = effectiveSchema(root, schema, value);
      } catch {
        return fallback;
      }
      if (eff.enum && eff.enum.length > 0) {
        return {
          kind: "enum" as const,
          enumValues: eff.enum.filter(
            (v): v is string | number =>
              typeof v === "string" || typeof v === "number"
          ),
          schema: eff,
        };
      }
      if (eff.type === "boolean") return { kind: "boolean" as const, schema: eff };
      // A `use`/`bigip` row sits inside a pointer object whose KEY is the AS3
      // property (profileTCP, monitors, …) — that is what decides which
      // estate objects may be offered.
      const leaf = path[path.length - 1];
      const ownerKey = path[path.length - 2];
      const externalOptions =
        (leaf === "use" || leaf === "bigip") && typeof ownerKey === "string"
          ? bigipCandidates(bigipCatalog, ownerKey).map((e) => ({
              fullPath: e.fullPath,
              label: `${e.name} — ${e.fullPath}`,
              summary: summarizeEntry(e),
            }))
          : [];
      const externalTargetPath = path.slice(0, -1);

      const classes = extractXrefClasses(root, schema);
      if (classes) {
        const seen = new Set<string>();
        const xrefOptions: { name: string; className: string }[] = [];
        for (const inst of indexClassInstances(lastGoodDoc)) {
          if (classes.length > 0 && !classes.includes(inst.className)) continue;
          if (seen.has(inst.name)) continue;
          seen.add(inst.name);
          xrefOptions.push({ name: inst.name, className: inst.className });
        }
        if (xrefOptions.length > 0 || externalOptions.length > 0)
          return {
            kind: "xref" as const,
            xrefOptions,
            externalOptions,
            externalTargetPath,
            schema: eff,
          };
      }
      if (eff.type === "integer" || eff.type === "number")
        return { kind: "number" as const, schema: eff };
      // A {bigip: …} row has no xref classes of its own, so offer the estate
      // list here too — retargeting is the whole point of that field.
      if (externalOptions.length > 0)
        return {
          kind: "string" as const,
          externalOptions,
          externalTargetPath,
          schema: eff,
        };
      const long =
        (typeof value === "string" && value.length > 40) ||
        (eff.maxLength ?? 0) > 100;
      return { kind: long ? ("longtext" as const) : ("string" as const), schema: eff };
    },
    [root, registry, lastGoodDoc, bigipCatalog]
  );

  const xrefAt = useCallback(
    (editorText: string, offset: number) =>
      xrefCandidatesAt(root, registry, editorText, offset),
    [root, registry]
  );

  // After applyEdit, the Monaco model receives the new text on the next React
  // commit; navigating before that clamps the offset. Poll briefly until the
  // model holds the expected text, then jump.
  const navigateWhenReady = useCallback(
    (
      path: JsonPath,
      expectedText: string,
      opts?: { flash?: boolean; flashChildren?: string[] },
      attempt = 0
    ) => {
      const model = editorRef.current?.getModel();
      if (model && model.getValue() === expectedText) {
        navigateToPath(path, opts ?? { flash: true });
        return;
      }
      if (attempt < 20)
        setTimeout(
          () => navigateWhenReady(path, expectedText, opts, attempt + 1),
          25
        );
    },
    [navigateToPath]
  );

  // Setting/changing an object's class: write the class, stub every
  // required property the object is missing, and flash them as needing input.
  // Append a schema-stubbed object item (e.g. a pool member with its
  // required props) and focus it once the text has propagated.
  const handleAppendObjectItem = useCallback(
    (arrayPath: JsonPath, index: number) => {
      const itemPath = [...arrayPath, index];
      const schema = resolveSchemaForPath(root, registry, lastGoodDoc, itemPath);
      let stub: unknown = {};
      if (schema) {
        try {
          stub = stubValue(root, schema);
        } catch {
          stub = {};
        }
      }
      const next = applyEdit(itemPath, stub);
      navigateWhenReady(itemPath, next, { flash: true });
    },
    [root, registry, lastGoodDoc, applyEdit, navigateWhenReady]
  );

  // Drop from the context panel into the editor: insert into the nearest
  // valid ancestor at the drop point (PLAN.md §8).
  const handleChipDrop = useCallback(
    (payloadJson: string, offset: number | null) => {
      let payload: DropPayload;
      try {
        payload = JSON.parse(payloadJson) as DropPayload;
      } catch {
        return;
      }
      const editorText = editorRef.current?.getModel()?.getValue() ?? text;
      const doc = parse(editorText, [], { allowTrailingComma: true }) as unknown;
      if (doc === undefined) {
        flashToast("Cannot insert while the JSON is invalid");
        return;
      }
      const dropOffset = offset ?? editorText.length - 1;
      const dropPath = getLocation(editorText, dropOffset).path as JsonPath;
      const res = resolveDrop(root, registry, doc, dropPath, payload);
      if (!res.ok) {
        flashToast(res.reason);
        return;
      }
      const targetPath = [...res.parentPath, res.key];
      const next = applyEdit(targetPath, res.value);
      const requiredChildren = isPlainObject(res.value)
        ? Object.keys(res.value).filter((k) => k !== "class")
        : [];
      navigateWhenReady(targetPath, next, {
        flashChildren: requiredChildren.length > 0 ? requiredChildren : undefined,
        flash: requiredChildren.length === 0,
      });
    },
    [root, registry, text, applyEdit, navigateWhenReady, flashToast]
  );

  const handleClassChange = useCallback(
    (path: JsonPath, className: string) => {
      const info = registry.get(className);
      if (!info) return;
      const stub = stubValue(root, info.schema);
      const existing = getAtPath(lastGoodDoc, path);
      const edits: [JsonPath, unknown][] = [[[...path, "class"], className]];
      const added: string[] = [];
      if (isPlainObject(stub)) {
        for (const [key, value] of Object.entries(stub)) {
          if (key === "class") continue;
          if (isPlainObject(existing) && key in existing) continue;
          edits.push([[...path, key], value]);
          added.push(key);
        }
      }
      const next = applyEditMany(edits);
      navigateWhenReady(path, next, {
        flashChildren: added.length > 0 ? added : undefined,
        flash: added.length === 0,
      });
    },
    [root, registry, lastGoodDoc, applyEditMany, navigateWhenReady]
  );

  // The JSON path deletable from a given line: the property whose key starts
  // the line, or the array element whose value starts it. Structural lines
  // (closing brackets, the root brace) return null.
  const deletableRowPath = useCallback(
    (editorText: string, lineStartOffset: number): JsonPath | null => {
      const ch = editorText[lineStartOffset];
      if (ch === undefined || ch === "}" || ch === "]" || ch === ",") return null;
      const loc = getLocation(editorText, lineStartOffset + 1);
      const path = loc.path as JsonPath;
      if (path.length === 0) return null;
      if (loc.isAtPropertyKey) return path;
      // Array element (string/number/object/array starting the line).
      if (typeof path[path.length - 1] === "number") return path;
      return null;
    },
    []
  );

  const handleDeleteRow = useCallback(
    (path: unknown) => {
      applyEdit(path as JsonPath, undefined);
    },
    [applyEdit]
  );

  const handleDeleteNode = useCallback(
    (path: JsonPath) => {
      if (path.length === 0) return;
      applyEdit(path, undefined);
      navigateToPath(path.slice(0, -1));
    },
    [applyEdit, navigateToPath]
  );

  // Double-click insertion: add the property (or new class object) into the
  // chip's own context. Drag-to-editor lands in Phase 4.
  const handleAddChip = useCallback(
    (payload: ChipPayload) => {
      if (payload.isClassObject && payload.className) {
        const info = registry.get(payload.className);
        if (!info) return;
        const appNode = lastGoodDoc
          ? (payload.sourcePath.reduce<unknown>(
              (acc, seg) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string | number, unknown>)[seg]
                  : undefined,
              lastGoodDoc
            ) as Record<string, unknown> | undefined)
          : undefined;
        let n = 1;
        let name = `new${payload.className.replace(/^Service_/, "Service")}${n}`;
        while (appNode && name in appNode) {
          n += 1;
          name = `new${payload.className.replace(/^Service_/, "Service")}${n}`;
        }
        const stub = stubValue(root, info.schema);
        const next = applyEdit([...payload.sourcePath, name], stub);
        const requiredChildren = isPlainObject(stub)
          ? Object.keys(stub).filter((k) => k !== "class")
          : [];
        navigateWhenReady([...payload.sourcePath, name], next, {
          flashChildren:
            requiredChildren.length > 0 ? requiredChildren : undefined,
          flash: requiredChildren.length === 0,
        });
        return;
      }
      const ctx = getContext(root, registry, debouncedText, cursorOffset);
      const prop = ctx.addableProps.find((p) => p.name === payload.name);
      const value = prop ? stubValue(root, prop.schema) : "";
      const next = applyEdit([...payload.sourcePath, payload.name], value);
      navigateWhenReady([...payload.sourcePath, payload.name], next);
    },
    [
      root,
      registry,
      debouncedText,
      cursorOffset,
      lastGoodDoc,
      applyEdit,
      navigateWhenReady,
    ]
  );

  return (
    <div className="app">
      <Toolbar
        schemaId={schemaId}
        onSchemaChange={setSchemaId}
        urlSchemas={urlSchemas}
        onAddSchemaUrl={() => setSchemaUrlDialog({ url: "", busy: false })}
        onLoadText={guardedLoad}
        currentText={text}
        onValidateOnBigip={() => setShowBigipDialog(true)}
        netboxEnabled={policy.netbox}
        onLoadFromNetbox={() => setShowNetboxDialog(true)}
        onLoadFromBigip={() => setShowBigipLoadDialog(true)}
        onPushToNetbox={() => setShowPushDialog(true)}
        pushPreview={pushPreview}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      {showBigipDialog && (
        <BigipDialog
          declarationText={text}
          applyEnabled={policy.bigipApply}
          onClose={() => setShowBigipDialog(false)}
        />
      )}
      {schemaUrlDialog && (
        <div className="modal-backdrop" onClick={() => setSchemaUrlDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Load schema from URL</h2>
            <p className="ctx-hint">
              The URL must return a JSON Schema (draft-07 style, like the F5
              AS3 schemas). Hosts without CORS headers are fetched through the
              dev-server proxy.
            </p>
            <label className="modal-field">
              <span>Schema URL</span>
              <input
                type="text"
                placeholder="https://raw.githubusercontent.com/F5Networks/f5-appsvcs-extension/main/schema/latest/as3-schema.json"
                value={schemaUrlDialog.url}
                autoFocus
                onChange={(e) =>
                  setSchemaUrlDialog({ ...schemaUrlDialog, url: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitSchemaUrl();
                }}
              />
            </label>
            {schemaUrlDialog.error && (
              <div className="modal-error">{schemaUrlDialog.error}</div>
            )}
            <div className="modal-actions">
              <button onClick={() => setSchemaUrlDialog(null)}>Cancel</button>
              <button
                className="primary"
                disabled={schemaUrlDialog.busy || schemaUrlDialog.url.trim() === ""}
                onClick={() => void submitSchemaUrl()}
              >
                {schemaUrlDialog.busy ? "Loading…" : "Load schema"}
              </button>
            </div>
          </div>
        </div>
      )}
      {policy.netbox && showPushDialog && (
        <PushNetboxDialog
          declarationText={text}
          onReloaded={loadText}
          onClose={() => setShowPushDialog(false)}
        />
      )}
      {showBigipLoadDialog && (
        <BigipLoadDialog
          onLoad={(newText) =>
            guardedLoad(newText, "the BIG-IP configuration")
          }
          onClose={() => setShowBigipLoadDialog(false)}
        />
      )}
      {policy.netbox && showNetboxDialog && (
        <NetboxDialog
          configWarnings={configWarnings}
          autoLoadAppId={deepLinkRef.current?.appId}
          onLoad={(newText) => {
            guardedLoad(newText, "the NetBox render", () => {
              // Deep link: jump to the object the callout referenced, using
              // the provenance manifest to map endpoint:id → AS3 key.
              const link = deepLinkRef.current;
              if (link?.object) {
                deepLinkRef.current = null;
                const declId = String(
                  (parse(newText, [], { allowTrailingComma: true }) as Record<
                    string,
                    unknown
                  >)?.id ?? ""
                );
                const manifest = netboxSession.manifests.get(declId);
                const entry = manifest?.entries.find(
                  (e) =>
                    e.endpoint === link.object!.endpoint &&
                    e.id === link.object!.id
                );
                if (manifest && entry) {
                  const path = entry.isApplication
                    ? [manifest.appKey]
                    : [manifest.appKey, entry.as3Key];
                  let flashChildren: string[] | undefined;
                  if (link.focus === "extra_parameters") {
                    const obj = getAtPath(
                      parse(newText, [], { allowTrailingComma: true }),
                      path
                    );
                    if (isPlainObject(obj)) {
                      flashChildren = Object.keys(
                        extrasFromAs3(entry.endpoint, obj) ?? {}
                      );
                    }
                  } else if (link.focus) {
                    flashChildren = [link.focus];
                  }
                  navigateWhenReady(path, newText, {
                    flashChildren:
                      flashChildren && flashChildren.length > 0
                        ? flashChildren
                        : undefined,
                    flash: !flashChildren || flashChildren.length === 0,
                  });
                }
              }
            });
          }}
          onClose={() => setShowNetboxDialog(false)}
        />
      )}
      <div className="main">
        <div className="pane-tree">
          <TreePane
            doc={lastGoodDoc}
            isStale={isStale}
            cursorPath={context.path}
            onSelect={(path) => navigateToPath(path)}
            onDelete={handleDeleteNode}
            isModified={isModifiedPath}
            relatedKeys={relatedKeys}
            onHoverPath={setHover}
            searchQuery={searchQuery}
            onSearchQuery={setSearchQuery}
            searchKeys={searchKeys}
          />
        </div>
        <div className="pane-editor">
          <div className="view-toggle">
            <button
              className={viewMode === "json" ? "active" : ""}
              onClick={() => setViewMode("json")}
            >
              JSON
            </button>
            <button
              className={viewMode === "simple" ? "active" : ""}
              onClick={() => setViewMode("simple")}
              title="Indented key-value view without JSON syntax"
            >
              Simple
            </button>
          </div>
          {viewMode === "simple" && (
            <SimplifiedPane
              doc={lastGoodDoc}
              cursorPath={context.path}
              isModified={isModifiedPath}
              onSelect={(path) => navigateToPath(path)}
              getInlineSpec={getInlineSpec}
              onEditValue={handleEdit}
              onEditMany={applyEditMany}
              onAppendObjectItem={handleAppendObjectItem}
              onHoverPath={setHover}
              relatedKeys={relatedKeys}
              searchKeys={searchKeys}
            />
          )}
          {/* Mounted only once the JSON view has been opened, so a session
              that stays in the simplified view never downloads Monaco. */}
          {jsonEverOpened && (
          <div
            className="editor-host"
            style={viewMode === "simple" ? { display: "none" } : undefined}
          >
          <Suspense
            fallback={<div className="pane-placeholder">Loading editor…</div>}
          >
          <EditorPane
            text={text}
            onTextChange={setText}
            schema={schemaEntry.schema}
            schemaId={schemaEntry.id}
            theme={theme}
            onEditorMount={(ed) => {
              editorRef.current = ed;
            }}
            onCursorOffsetChange={setCursorOffset}
            onHoverOffsetChange={hoverOffsetToPath}
            choiceValueStartAt={choiceValueStartAt}
            xrefCandidatesAt={xrefAt}
            onChipDrop={handleChipDrop}
            deletableRowPath={deletableRowPath}
            onDeleteRow={handleDeleteRow}
          />
          </Suspense>
          </div>
          )}
        </div>
        <div className="pane-context">
          <ContextPanel
            context={context}
            doc={lastGoodDoc}
            isStale={isStale}
            memberClasses={memberClasses}
            schemaRoot={root}
            documentation={documentation}
            onEdit={handleEdit}
            onNavigate={(path) => navigateToPath(path)}
            onAddChip={handleAddChip}
            onDeleteNode={handleDeleteNode}
            onClassChange={handleClassChange}
          />
        </div>
      </div>
      {pendingLoad && (
        <div className="modal-backdrop" onClick={() => setPendingLoad(null)}>
          <div
            className="modal modal-narrow"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Replace the current document?</h2>
            <p className="ctx-hint">
              Loading {pendingLoad.source} discards{" "}
              {modifiedMemberCount > 0
                ? `your unsaved edits to ${modifiedMemberCount} object${modifiedMemberCount === 1 ? "" : "s"}`
                : "your unsaved edits"}
              . Save first if you want to keep them.
            </p>
            <div className="modal-actions">
              <button autoFocus onClick={() => setPendingLoad(null)}>
                Keep my edits
              </button>
              <button
                className="danger"
                onClick={() => {
                  const load = pendingLoad;
                  setPendingLoad(null);
                  loadText(load.text);
                  load.andThen?.();
                }}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {hoverAnchor && (
        <HoverCard
          anchor={hoverAnchor}
          onPointerEnter={cancelHoverClose}
          onPointerLeave={closeHoverNow}
          pinned={hoverPinned}
          onPin={() => setHoverPinned(true)}
          onUnpin={unpinHover}
          doc={lastGoodDoc}
          schemaRoot={root}
          registry={registry}
          documentation={documentation}
        />
      )}

      <div className="errorbar-wrap">
        {showIssues && issues.length > 0 && (
          <div className="issue-list">
            {issues.map((issue, i) => (
              <div
                key={`${issue.instancePath}-${i}`}
                className="issue-row"
                onClick={() => navigateToPath(issue.path)}
              >
                <span className="issue-path">{issue.instancePath}</span>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="errorbar">
          <span className="statusbar-crumb" title="Cursor context — new properties and objects insert here">
            ◎ {context.breadcrumb}
          </span>
          {context.isApplication && (
            <span className="statusbar-hint">new objects drop into this application</span>
          )}
          {!context.isApplication && context.className && (
            <span className="statusbar-hint">
              new properties drop into this {context.className}
            </span>
          )}
          <span className="statusbar-spacer" />
          {isStale ? (
            <span className="statusbar-issues warn">syntax error — fix JSON</span>
          ) : !validatorReady ? (
            <span className="statusbar-hint">validating…</span>
          ) : issues.length === 0 ? (
            <span className="ok">✓ schema valid</span>
          ) : (
            <button
              className="statusbar-issues"
              onClick={() => setShowIssues(!showIssues)}
              title="Click to show/hide the error list"
            >
              ✗ {issues.length} schema error{issues.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
