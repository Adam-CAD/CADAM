// This component now delegates to the ParametricEditorView which handles
// all business logic (mutations, message handling) and renders ParametricView
// for the UI layout. This re-export maintains backwards compatibility.
export { ParametricEditorView as ParametricEditor } from '@/views/ParametricEditorView';
