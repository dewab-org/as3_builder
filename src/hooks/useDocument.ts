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

  const applyEdit = useCallback(
    (path: JsonPath, value: unknown): string => {
      let next = text;
      try {
        const edits = modify(text, path, value, {
          formattingOptions: FORMATTING,
        });
        next = applyEdits(text, edits);
        setText(next);
      } catch {
        // Text too broken to edit structurally; leave it untouched.
      }
      return next;
    },
    [text]
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
  };
}
