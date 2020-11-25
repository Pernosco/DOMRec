import { DOMRecFrame } from './DOMRecFrame';
import {
  DOMREC_ADD,
  DOMREC_ATTR,
  DOMREC_CANVAS_DATA,
  DOMREC_DELAY,
  DOMREC_FRAME,
  DOMREC_INPUT,
  DOMREC_LABEL,
  DOMREC_REMOVE,
  DOMREC_SCROLL,
  DOMREC_TEXT
} from './constants';

export class DOMRecorder {
  public nextID = 1;
  public actions = [];

  public lastActionTime = Date.now();
  public nestedObserverCallbacks = 0;
  public rootFrame: DOMRecFrame;
  public focusedElement = null;
  public observerCallback = this.callback;
  public observer: IntersectionObserver;

  constructor(node: any) {
    this.rootFrame = new DOMRecFrame(window, node, this, null);
    this.evaluateFocus();
    this.rootFrame.initialState[1] = this.rootFrame.initialState[1].concat(this.actions);
    this.actions = [];
  }

  public iframeLoadedListener = (event): void => this.iframeLoaded(event.target, this.actions);

  public clearFakeFocus(): void {
    if (!this.focusedElement) {
      return;
    }
    this.focusedElement.removeAttribute('fakeFocus');
    let ancestor = this.focusedElement;
    while (ancestor) {
      ancestor.removeAttribute('fakeFocusWithin');
      const nextAncestor = ancestor.parentElement;
      if (!nextAncestor) {
        ancestor = ancestor.ownerDocument.DOMRecInner.iframeElement;
      } else {
        ancestor = nextAncestor;
      }
    }
  }

  public evaluateFocus(): void {
    let frame = this.rootFrame;
    let e;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      e = frame.win.document.activeElement;
      if (!frame.node.contains(e)) {
        e = null;
        break;
      }
      if (e.tagName === 'IFRAME') {
        frame = e.contentDocument.DOMRecInner;
      } else {
        break;
      }
    }
    if (e === this.focusedElement) {
      return;
    }
    this.clearFakeFocus();
    e.setAttribute('fakeFocus', '');
    let ancestor = e;
    while (ancestor) {
      ancestor.setAttribute('fakeFocusWithin', '');
      const nextAncestor = ancestor.parentElement;
      if (!nextAncestor) {
        ancestor.ownerDocument.DOMRecInner.flushObserver();
        ancestor = ancestor.ownerDocument.DOMRecInner.iframeElement;
      } else {
        ancestor = nextAncestor;
      }
    }
    // Flush observer so that during startup we have the right set of actions
    this.rootFrame.flushObserver();
    this.focusedElement = e;
  }

  public stop(): { initialState: any; actions: any; width: any; height: any } {
    const width = this.rootFrame.node.getBoundingClientRect().width;
    const height = this.rootFrame.node.getBoundingClientRect().height;
    const ret = {
      initialState: this.rootFrame.initialState,
      actions: this.actions,
      width,
      height
    };
    this.rootFrame.stop();
    this.clearFakeFocus();
    this.rootFrame = null;
    return ret;
  }

  public allowAttribute(e: HTMLElement, name: string): boolean {
    switch (name) {
      case 'src':
      case 'srcdoc':
        if (e.tagName === 'IFRAME') {
          return false;
        }
        break;
      case 'title':
        return false;
    }
    return true;
  }

  public pushScrollAction(id, element, actionsList): void | never {
    const actions = actionsList ? actionsList : this.actions;
    const scrolledIntoView = element.elementScrolledIntoView;
    if (scrolledIntoView) {
      const a = {};
      if (scrolledIntoView.DOMRecID) {
        const scrolledIntoViewOffset =
          'elementScrolledIntoViewOffset' in element ? element.elementScrolledIntoViewOffset : null;
        a[DOMREC_SCROLL] = [id, scrolledIntoView.DOMRecID, scrolledIntoViewOffset];
      } else {
        if (scrolledIntoView !== 'bottom') {
          throw new Error(`Unknown scrolledIntoView: ${scrolledIntoView}`);
        }
        a[DOMREC_SCROLL] = [id, scrolledIntoView];
      }
      actions.push(a);
    } else {
      // eslint-disable-next-line no-console
      console.log('Warning: unknown scroll operation ignored');
    }
  }

  public serializeNode(node, actions): { id: number; a?: any; c?: any; d?: any } | never {
    if ('DOMRecID' in node) {
      throw new Error(`Already serialized ${node.DOMRecID}`);
    }
    const id = this.nextID++;
    const obj: { id: number; a?: any; c?: any; d?: any } = { id };
    node.DOMRecID = id;
    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const tag = node.tagName;
        switch (tag) {
          case 'INPUT':
          case 'TEXTAREA': {
            const a = {};
            a[DOMREC_INPUT] = [id, node.value];
            actions.push(a);
            const listener = node.ownerDocument.DOMRecInner.scrollListener;
            node.addEventListener('scroll', listener, { passive: true });
            break;
          }
          case 'PRE':
          case 'DIV': {
            if (
              node.classList.contains('hidden') &&
              (window as any).DOMREC_SKIP_HIDDEN_IDS.indexOf(node.id) >= 0
            ) {
              delete node.DOMRecID;
              return null;
            }
            // In Pernosco all scrollable elements happen to be DIV/INPUT/TEXTAREA
            const listener = node.ownerDocument.DOMRecInner.scrollListener;
            node.addEventListener('scroll', listener, { passive: true });
            break;
          }
          case 'SCRIPT':
          case 'LINK':
            delete node.DOMRecID;
            return null;
          case 'CANVAS': {
            const a = {};
            a[DOMREC_CANVAS_DATA] = [id, node.toDataURL()];
            actions.push(a);
            break;
          }
          case 'IFRAME':
            this.attachToIFrame(node, actions);
            break;
        }
        obj[''] = tag;
        const attrs = {};
        let hasAttr = false;
        for (const a of node.attributes) {
          const name = a.name;
          if (this.allowAttribute(node, name)) {
            attrs[name] = a.value;
            hasAttr = true;
          }
        }
        if (hasAttr) {
          obj.a = attrs;
        }
        const children = [];
        for (const c of node.childNodes) {
          const serialized = this.serializeNode(c, actions);
          if (serialized) {
            children.push(serialized);
          }
        }
        if (children.length > 0) {
          obj.c = children;
        }
        if (node.scrollLeft || node.scrollTop) {
          this.pushScrollAction(id, node, actions);
        }
        break;
      }
      case Node.TEXT_NODE:
      case Node.CDATA_SECTION_NODE: {
        const data = node.data;
        if (data.length > 0) {
          obj.d = data;
        }
        break;
      }
      case Node.PROCESSING_INSTRUCTION_NODE:
      case Node.COMMENT_NODE:
        break;
      default:
        delete node.DOMRecID;
        throw new Error(`Bad node ${node}`);
    }
    return obj;
  }

  public attachToIFrame(e, actions): void {
    e.addEventListener('load', this.iframeLoadedListener);
    if (e.contentDocument && e.contentDocument.readyState === 'complete') {
      this.iframeLoaded(e, actions);
    }
  }

  public iframeLoaded(e, actions): void {
    e.DOMRecInner = new DOMRecFrame(e.contentWindow, e.contentDocument.body, this, e);
    const bodyElement = e.DOMRecInner.initialState[0];
    if (!bodyElement.c) {
      bodyElement.c = [];
    }
    for (let c = e.contentDocument.head.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === 'STYLE') {
        bodyElement.c.push(this.serializeNode(c, e.DOMRecInner.initialState[1]));
        this.deleteAllDOMRecIDs(c);
      } else if (c.tagName === 'LINK' && c.getAttribute('rel') === 'stylesheet') {
        let href = c.getAttribute('href');
        const lastSlash = href.lastIndexOf('/');
        if (lastSlash >= 0) {
          href = href.substring(lastSlash + 1);
        }
        const style = {
          '': 'STYLE',
          a: { cached: href },
          id: this.nextID++
        };
        bodyElement.c.push(style);
      }
    }
    const styles = {
      '': 'STYLE',
      c: [{ d: '.scrollbar { opacity: 0 ! important }', id: this.nextID++ }],
      id: this.nextID++
    };
    bodyElement.c.push(styles);
    const a = {};
    a[DOMREC_FRAME] = [e.DOMRecID, bodyElement];
    actions.push(a);
    for (const aa of e.DOMRecInner.initialState[1]) {
      actions.push(aa);
    }
    delete e.DOMRecInner.initialState;
  }

  public detachFromIFrame(e): void {
    // XXX not sure how this can be null
    if (e.DOMRecInner) {
      e.DOMRecInner.stop();
    }
    e.removeEventListener('load', this.iframeLoadedListener);
  }

  public label(name): void {
    this.callback(this.observer.takeRecords());
    const a = {};
    a[DOMREC_LABEL] = name;
    this.actions.push(a);
  }

  public delay(seconds: number): void {
    this.lastActionTime -= seconds * 1000;
  }

  public deleteAllDOMRecIDs(e): void {
    delete e.DOMRecID;
    const listener = e.ownerDocument.DOMRecInner.scrollListener;
    e.removeEventListener('scroll', listener, { passive: true });
    for (let c = e.firstChild; c; c = c.nextSibling) {
      if (c.DOMRecID) {
        this.deleteAllDOMRecIDs(c);
      }
    }
    if (e.tagName === 'IFRAME') {
      this.detachFromIFrame(e);
    }
  }

  public callback(
    records: IntersectionObserverEntry[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    observer?: IntersectionObserver
  ): void | never {
    // Observer callbacks can nest when we flush while detaching from an IFRAME
    if (this.nestedObserverCallbacks === 0) {
      const now = Date.now();
      if (now > this.lastActionTime) {
        const a = {};
        a[DOMREC_DELAY] = now - this.lastActionTime;
        this.actions.push(a);
      }
    }
    ++this.nestedObserverCallbacks;

    try {
      // A node has a DOMRecID if and only if it was in the non-excluded DOM at the start of the records
      // batch.
      // If a node has a DOMRecID and is not our root, then its parent must also
      // have a DOMRecID.

      for (const r of records) {
        if ((r.target as any).DOMRecID && (r as any).type === 'childList') {
          for (const child of (r as any).removedNodes) {
            const childID = child.DOMRecID;
            if (!childID) {
              continue;
            }
            const a = {};
            a[DOMREC_REMOVE] = childID;
            this.actions.push(a);
            this.deleteAllDOMRecIDs(child);
          }
        }
      }

      // A node has a DOMRecID if and only if it was in the non-excluded DOM at the start of the records
      // batch, and was not ever removed during this records batch.
      // If a node has a DOMRecID and is not our root, then its parent must also
      // have a DOMRecID.

      const nodesWithAddedChildren = [];
      for (const r of records) {
        const target = r.target;
        const id = (target as any).DOMRecID;
        if (!id) {
          // Node not in non-excluded DOM at the start of the records batch.
          continue;
        }
        switch ((r as any).type) {
          case 'attributes': {
            const attributeName = (r as any).attributeName;
            if (this.allowAttribute(target as HTMLElement, attributeName)) {
              const a = {};
              a[DOMREC_ATTR] = [id, attributeName, target.getAttribute(attributeName)];
              this.actions.push(a);
            }
            break;
          }
          case 'characterData': {
            const a = {};
            a[DOMREC_TEXT] = [id, (target as any).data];
            this.actions.push(a);
            break;
          }
          case 'childList': {
            if ((r as any).addedNodes.length > 0 && !(target as any).DOMRecNodesAdded) {
              (target as any).DOMRecNodesAdded = true;
              nodesWithAddedChildren.push(target);
            }
          }
        }
      }

      for (const node of nodesWithAddedChildren) {
        delete node.DOMRecNodesAdded;
        for (let c = node.lastChild; c; c = c.previousSibling) {
          if (c.DOMRecID) {
            continue;
          }
          const a = {};
          const actions = [];
          const serializedNode = this.serializeNode(c, actions);
          if (!serializedNode) {
            continue;
          }
          const nextSibling = c.nextSibling;
          a[DOMREC_ADD] = [
            node.DOMRecID,
            nextSibling ? nextSibling.DOMRecID : null,
            serializedNode,
            actions
          ];
          this.actions.push(a);
        }
      }
    } catch (ex) {
      --this.nestedObserverCallbacks;
      // eslint-disable-next-line no-console
      console.log('MutationObserver exception: ', ex);
      throw ex;
    }

    --this.nestedObserverCallbacks;
    if (this.nestedObserverCallbacks === 0) {
      // Ignore time spent doing DOMRec recording.
      // Note that during this processing, the browser might be downloading stuff or
      // doing other off-main-thread work, so this could give an optimistic picture
      // of actual performance. Doesn't really matter.
      this.lastActionTime = Date.now();
    }
  }
}
