import { useCallback, useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { openScadLanguageSupport } from '@/lib/openscad/language';

type OpenSCADCodeEditorProps = {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
};

const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1f1f1f',
    color: '#eaeaea',
    height: '100%',
    fontFamily:
      'JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '12px',
  },
  '.cm-content': {
    caretColor: '#ffffff',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    {
      backgroundColor: 'rgba(0, 166, 255, 0.3)',
    },
  '.cm-gutters': {
    backgroundColor: '#191919',
    color: '#888',
    border: 'none',
  },
});

export function OpenSCADCodeEditor({
  value,
  onChange,
  readOnly = false,
}: OpenSCADCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const createView = useCallback(
    (parent: HTMLDivElement) => {
      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const text = update.state.doc.toString();
          if (text !== valueRef.current) {
            onChange(text);
          }
        }
      });

      const extensions = [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap,
        ]),
        autocompletion(),
        openScadLanguageSupport(),
        baseTheme,
        updateListener,
      ];

      if (readOnly) {
        extensions.push(EditorState.readOnly.of(true));
        extensions.push(EditorView.editable.of(false));
      }

      const state = EditorState.create({
        doc: valueRef.current,
        extensions,
      });

      viewRef.current = new EditorView({ state, parent });
    },
    [onChange, readOnly],
  );

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return undefined;
    createView(parent);
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createView]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (value !== currentValue) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden rounded-md border border-adam-neutral-800"
    />
  );
}
