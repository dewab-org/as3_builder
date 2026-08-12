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

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" };
const PARSE_DEBOUNCE_MS = 150;

export interface DocumentState {
  text: string;
  setText: (text: string) => void;
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
}

export function useDocument(initialText: string): DocumentState {
  const [text, setText] = useState(initialText);
  const [debouncedText, setDebouncedText] = useState(initialText);
  const lastGoodRef = useRef<unknown>(undefined);

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
        setText(next);
      } catch {
        // Text too broken to edit structurally; leave it untouched.
        return text;
      }
      return next;
    },
    [text]
  );

  const applyEdit = useCallback(
    (path: JsonPath, value: unknown): string => applyEditMany([[path, value]]),
    [applyEditMany]
  );

  return {
    text,
    setText,
    debouncedText,
    tree,
    lastGoodDoc: lastGoodRef.current,
    isStale,
    parseErrors,
    applyEdit,
    applyEditMany,
  };
}
