// Live Preview: show `{{bw:...}}` as a secret widget unless the cursor is inside it.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { findRefs, type SecretRef } from "./secret-ref.ts";
import { renderSecret, type WidgetContext } from "./secret-widget.ts";

class SecretWidget extends WidgetType {
  private readonly ref: SecretRef;
  private readonly revision: number;
  private readonly ctx: WidgetContext;

  constructor(ref: SecretRef, revision: number, ctx: WidgetContext) {
    super();
    this.ref = ref;
    this.revision = revision;
    this.ctx = ctx;
  }

  // Same reference and same session state: CodeMirror can keep the existing DOM.
  eq(other: SecretWidget): boolean {
    return other.revision === this.revision && JSON.stringify(other.ref) === JSON.stringify(this.ref);
  }

  toDOM(): HTMLElement {
    const el = createSpan();
    renderSecret(el, this.ref, this.ctx);
    return el;
  }
}

const sessionChanged = StateEffect.define<null>();

const PARSE_BUDGET_MS = 20;

function inCode(view: EditorView, pos: number): boolean {
  // the background parse may not have reached pos yet on a freshly opened long note
  const tree = ensureSyntaxTree(view.state, pos, PARSE_BUDGET_MS) ?? syntaxTree(view.state);
  return /code/.test(tree.resolveInner(pos, 1).name);
}

function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function buildDecorations(view: EditorView, ctx: WidgetContext): DecorationSet {
  if (!view.state.field(editorLivePreviewField)) return Decoration.none; // Source mode shows raw text
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    for (const m of findRefs(text)) {
      const from = range.from + m.from;
      const to = range.from + m.to;
      if (selectionTouches(view, from, to) || inCode(view, from)) continue;
      builder.add(from, to, Decoration.replace({ widget: new SecretWidget(m.ref, ctx.session.revision, ctx) }));
    }
  }
  return builder.finish();
}

export function secretLivePreview(ctx: WidgetContext): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly unsubscribe: () => void;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, ctx);
        this.unsubscribe = ctx.session.onChange(() => view.dispatch({ effects: sessionChanged.of(null) }));
      }

      update(u: ViewUpdate): void {
        const modeChanged = u.startState.field(editorLivePreviewField) !== u.state.field(editorLivePreviewField);
        const lockChanged = u.transactions.some((t) => t.effects.some((e) => e.is(sessionChanged)));
        if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged || lockChanged) {
          this.decorations = buildDecorations(u.view, ctx);
        }
      }

      destroy(): void {
        this.unsubscribe();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
