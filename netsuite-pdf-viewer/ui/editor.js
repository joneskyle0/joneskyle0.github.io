// Bundled by scripts/build-ui.js into public/vendor/editor.js
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';

const languages = { ftl: () => html({ matchClosingTags: true, autoCloseTags: false }), json: () => json() };

export function createEditor({ parent, doc = '', language = 'ftl', onChange, onSave }) {
  const langCompartment = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([{ key: 'Mod-s', run: () => { onSave && onSave(); return true; } }]),
        langCompartment.of(languages[language]()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => { if (u.docChanged && onChange) onChange(u.state.doc.toString()); }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' }
        })
      ]
    })
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text, lang) => {
      const effects = lang && languages[lang] ? [langCompartment.reconfigure(languages[lang]())] : [];
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, effects });
    },
    gotoLine: (line, col = 1) => {
      try {
        const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      } catch { /* ignore */ }
    }
  };
}
