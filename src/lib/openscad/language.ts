import { cppLanguage } from '@codemirror/lang-cpp';
import {
  HighlightStyle,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { completeFromList } from '@codemirror/autocomplete';

const OPENSCAD_KEYWORDS = [
  'module',
  'function',
  'if',
  'else',
  'for',
  'let',
  'include',
  'use',
  'true',
  'false',
];

const OPENSCAD_BUILTINS = [
  'cube',
  'sphere',
  'cylinder',
  'polyhedron',
  'polygon',
  'difference',
  'union',
  'intersection',
  'translate',
  'rotate',
  'scale',
  'mirror',
  'color',
  'offset',
  'hull',
  'minkowski',
  'linear_extrude',
  'rotate_extrude',
  'surface',
  'projection',
  'text',
  'import',
  'resize',
  'render',
  'children',
  'assign',
  'len',
  'abs',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'ceil',
  'floor',
  'round',
  'min',
  'max',
  'pow',
  'sqrt',
  'sign',
  'log',
  'ln',
  'concat',
];

const OPENSCAD_COMPLETIONS = completeFromList([
  ...OPENSCAD_KEYWORDS.map((keyword) => ({
    label: keyword,
    type: 'keyword' as const,
  })),
  ...OPENSCAD_BUILTINS.map((fn) => ({
    label: fn,
    type: 'function' as const,
  })),
]);

const openScadHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#6ab7ff' },
  { tag: t.definitionKeyword, color: '#6ab7ff' },
  { tag: t.bool, color: '#ffcb6b' },
  { tag: t.variableName, color: '#dcdcdc' },
  { tag: t.typeName, color: '#ffcb6b' },
  { tag: t.string, color: '#c3e88d' },
  { tag: t.number, color: '#f78c6c' },
  { tag: t.comment, color: '#546e7a' },
  { tag: t.operator, color: '#89ddff' },
  { tag: t.paren, color: '#d4d4d4' },
  { tag: t.brace, color: '#d4d4d4' },
  { tag: t.squareBracket, color: '#d4d4d4' },
]);

export function openScadLanguageSupport() {
  return new LanguageSupport(cppLanguage, [
    cppLanguage.data.of({
      autocomplete: OPENSCAD_COMPLETIONS,
      commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    }),
    syntaxHighlighting(openScadHighlightStyle),
  ]);
}

export const OPENSCAD_KEYWORD_SET = new Set(OPENSCAD_KEYWORDS);
export const OPENSCAD_BUILTIN_SET = new Set(OPENSCAD_BUILTINS);
