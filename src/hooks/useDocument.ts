import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdits,
  modify,
  parse,
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type { JsonPath } from "../engine";
import * as hist from "./history";
import type { History } from "./history";

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" };
const PARSE_DEBOUNCE_MS = 150;

export interface DocumentState {
  text: string;
  setText: (text: string) => void;
  /** Replace the document as a distinct history entry (load/template/open). */
  replaceText: (text: string) => void;
  /** Debounced text the derived views (tree/context) are computed from. */
  debouncedText: string;
  /** Fault-tolerant AST of debouncedText (undefined for empty text). */
  tree: Node | undefined;
  /** Parsed value of the most recent text that had no parse errors. */
  lastGoodDoc: unknown;
  /** True when the current (debounced) text has parse errors. */
  isStale: boolean;
  parseErrors: ParseError[];
  /** Insert/replace (value) or delete (undefined) at path, preserving formatting. */
  applyEdit: (path: JsonPath, value: unknown) => string;
  /** Apply several path edits atomically (sequentially on one base text). */
  applyEditMany: (edits: [JsonPath, unknown][]) => string;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useDocument(initialText: string): DocumentState {
  // The document IS the current history entry, so every path that changes it
  // — typing, panel widgets, inline edits, drops, NetBox loads — is undoable,
  // not just the ones Monaco's own stack sees.
  const [history, setHistory] = useState<History>(() =>
    hist.initHistory(initialText)
  );
  const text = hist.current(history);
  const [debouncedText, setDebouncedText] = useState(initialText);
  const lastPushAt = useRef(0);
  const lastGoodRef = useRef<unknown>(undefined);

  const pushText = useCallback((next: string, coalesce: boolean) => {
    const now = Date.now();
    const canCoalesce = coalesce && now - lastPushAt.current < hist.COALESCE_MS;
    lastPushAt.current = now;
    setHistory((h) => hist.push(h, next, canCoalesce));
  }, []);

  const setText = useCallback(
    (next: string) => pushText(next, true),
    [pushText]
  );
  const replaceText = useCallback(
    (next: string) => pushText(next, false),
    [pushText]
  );

  const undo = useCallback(() => {
    setHistory(hist.undo);
    lastPushAt.current = 0; // don't coalesce onto a restored entry
  }, []);
  const redo = useCallback(() => {
    setHistory(hist.redo);
    lastPushAt.current = 0;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(text), PARSE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const { tree, parseErrors, doc } = useMemo(() => {
    const errors: ParseError[] = [];
    const tree = parseTree(debouncedText, errors, { allowTrailingComma: true });
    const doc =
      errors.length === 0
        ? (parse(debouncedText, [], { allowTrailingComma: true }) as unknown)
        : undefined;
    return { tree, parseErrors: errors, doc };
  }, [debouncedText]);

  const isStale = parseErrors.length > 0;
  if (!isStale) lastGoodRef.current = doc;

  const applyEditMany = useCallback(
    (pathEdits: [JsonPath, unknown][]): string => {
      let next = text;
      try {
        for (const [path, value] of pathEdits) {
          const edits = modify(next, path, value, {
            formattingOptions: FORMATTING,
          });
          next = applyEdits(next, edits);
        }
        // Structural edits are discrete actions: never coalesce them.
        pushText(next, false);
      } catch {
        // Text too broken to edit structurally; leave it untouched.
        return text;
      }
      return next;
    },
    [text, pushText]
  );

  const applyEdit = useCallback(
    (path: JsonPath, value: unknown): string => applyEditMany([[path, value]]),
    [applyEditMany]
  );

  return {
    text,
    setText,
    replaceText,
    debouncedText,
    tree,
    lastGoodDoc: lastGoodRef.current,
    isStale,
    parseErrors,
    applyEdit,
    applyEditMany,
    undo,
    redo,
    canUndo: hist.canUndo(history),
    canRedo: hist.canRedo(history),
  };
}
