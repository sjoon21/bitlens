// Reading view: replace `{{bw:...}}` text with live secret widgets.

import { MarkdownRenderChild, type MarkdownPostProcessor } from "obsidian";
import { findRefs, type SecretRef } from "./secret-ref.ts";
import { renderSecret, type WidgetContext } from "./secret-widget.ts";

// Re-renders on lock/unlock/sync; unsubscribes when Obsidian unloads the rendered section.
class SecretChild extends MarkdownRenderChild {
  private readonly ref: SecretRef;
  private readonly ctx: WidgetContext;

  constructor(el: HTMLElement, ref: SecretRef, ctx: WidgetContext) {
    super(el);
    this.ref = ref;
    this.ctx = ctx;
  }

  onload(): void {
    const render = () => renderSecret(this.containerEl, this.ref, this.ctx);
    render();
    this.register(this.ctx.session.onChange(render));
  }
}

// Code is left alone so the syntax can be documented in notes.
function textNodesOutsideCode(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function secretPostProcessor(ctx: WidgetContext): MarkdownPostProcessor {
  return (el, mdCtx) => {
    for (const node of textNodesOutsideCode(el)) {
      const text = node.data;
      const refs = findRefs(text);
      if (!refs.length) continue;
      const frag = createFragment();
      let pos = 0;
      for (const { from, to, ref } of refs) {
        frag.append(text.slice(pos, from));
        const span = createSpan();
        frag.append(span);
        mdCtx.addChild(new SecretChild(span, ref, ctx));
        pos = to;
      }
      frag.append(text.slice(pos));
      node.replaceWith(frag);
    }
  };
}
