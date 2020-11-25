/* Copyright Pernosco 2020. See LICENSE. */

import { DOMRecFrame } from './DOMRecFrame';
import {
  DOMREC_ADD,
  DOMREC_CANVAS_DATA,
  DOMREC_DELAY,
  DOMREC_FRAME,
  DOMREC_FORCE_STYLE_FLUSH,
  DOMREC_INPUT,
  DOMREC_LABEL,
  DOMREC_MOUSE_MOVE,
  DOMREC_MOUSE_DOWN,
  DOMREC_ATTR,
  DOMREC_TEXT,
  DOMREC_MOUSE_UP,
  DOMREC_REMOVE,
  DOMREC_SCROLL
} from './constants';

const DOMREC_SKIP_HIDDEN_IDS = ['toolbox'];

(window as any).DOMREC_SKIP_HIDDEN_IDS = DOMREC_SKIP_HIDDEN_IDS;

function DOMRec(node): void {
  this.nextID = 1;
  this.actions = [];
  this.lastActionTime = Date.now();
  this.nestedObserverCallbacks = 0;
  this.observerCallback = this.callback.bind(this);
  this.iframeLoadedListener = (event): void => this.iframeLoaded(event.target, this.actions);
  this.rootFrame = new DOMRecFrame(window, node, this, null);
  this.focusedElement = null;
  this.evaluateFocus();
  this.rootFrame.initialState[1] = this.rootFrame.initialState[1].concat(this.actions);
  this.actions = [];
}

DOMRec.prototype.clearFakeFocus = function (): void {
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
};

DOMRec.prototype.evaluateFocus = function (): void {
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
};

DOMRec.prototype.stop = function (): { initialState: any; actions: any; width: any; height: any } {
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
};

DOMRec.prototype.allowAttribute = function (e: HTMLElement, name: string): boolean {
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
};

DOMRec.prototype.pushScrollAction = function (id, element, actionsList): void | never {
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
};

DOMRec.prototype.serializeNode = function (
  node,
  actions
): { id: number; a?: any; c?: any; d?: any } | never {
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
          if (node.classList.contains('hidden') && DOMREC_SKIP_HIDDEN_IDS.indexOf(node.id) >= 0) {
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
};

DOMRec.prototype.attachToIFrame = function (e, actions): void {
  e.addEventListener('load', this.iframeLoadedListener);
  if (e.contentDocument && e.contentDocument.readyState === 'complete') {
    this.iframeLoaded(e, actions);
  }
};

DOMRec.prototype.iframeLoaded = function (e, actions): void {
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
};

DOMRec.prototype.detachFromIFrame = function (e): void {
  // XXX not sure how this can be null
  if (e.DOMRecInner) {
    e.DOMRecInner.stop();
  }
  e.removeEventListener('load', this.iframeLoadedListener);
};

DOMRec.prototype.label = function (name): void {
  this.callback(this.observer.takeRecords());
  const a = {};
  a[DOMREC_LABEL] = name;
  this.actions.push(a);
};

DOMRec.prototype.delay = function (seconds: number): void {
  this.lastActionTime -= seconds * 1000;
};

DOMRec.prototype.deleteAllDOMRecIDs = function (e): void {
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
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
DOMRec.prototype.callback = function (records, observer?: Function): void | never {
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
      if (r.target.DOMRecID && r.type === 'childList') {
        for (const child of r.removedNodes) {
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
      const id = target.DOMRecID;
      if (!id) {
        // Node not in non-excluded DOM at the start of the records batch.
        continue;
      }
      switch (r.type) {
        case 'attributes': {
          const attributeName = r.attributeName;
          if (this.allowAttribute(target, attributeName)) {
            const a = {};
            a[DOMREC_ATTR] = [id, attributeName, target.getAttribute(attributeName)];
            this.actions.push(a);
          }
          break;
        }
        case 'characterData': {
          const a = {};
          a[DOMREC_TEXT] = [id, target.data];
          this.actions.push(a);
          break;
        }
        case 'childList': {
          if (r.addedNodes.length > 0 && !target.DOMRecNodesAdded) {
            target.DOMRecNodesAdded = true;
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
};

function DOMReplay(hostElem): void {
  const state = window[hostElem.id] as any;
  this.initialState = state.initialState;
  this.actions = state.actions;
  this.width = state.width;
  this.height = state.height;
  this.hostElem = hostElem;
  const hostFrame = hostElem.lastChild;
  this.hostDoc = hostFrame.contentDocument;
  this.host = this.hostDoc.body;
  this.index = 0;
  this.scaleX = 1;
  this.scaleY = 1;
  this.nodes = {};
  this.cursor = this.hostDoc.createElement('div');
  const cursorImage = this.hostDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cursorImage.setAttribute('viewBox', '0 0 320 512');
  cursorImage.innerHTML =
    '<path d="M302.189 329.126H196.105l55.831 135.993c3.889 9.428-.555 19.999-9.444 23.999l-49.165 21.427c-9.165 4-19.443-.571-23.332-9.714l-53.053-129.136-86.664 89.138C18.729 472.71 0 463.554 0 447.977V18.299C0 1.899 19.921-6.096 30.277 5.443l284.412 292.542c11.472 11.179 3.007 31.141-12.5 31.141z"/>';
  this.cursor.setAttribute('class', 'mouseCursor');
  this.cursor.appendChild(cursorImage);
  this.reset();
  this.pendingTimeout = null;
  this.caretElement = null;
  this.maybeFocusedElement = null;
  this.maybeFocusedElementChanged = false;

  const resize = (): void => {
    const margin = 2;
    this.scaleX = (this.hostDoc.defaultView.innerWidth - 2 * margin) / state.width;
    this.scaleY = (this.hostDoc.defaultView.innerHeight - 2 * margin) / state.height;
    this.hostDoc.body.style.transform = `translate(2px, 2px) scale(${this.scaleX},${this.scaleY})`;
  };
  resize();
  hostFrame.contentWindow.addEventListener('resize', resize);
}

DOMReplay.prototype.reset = function (): void {
  this.index = 0;
  this.nodes = {};
  this.host.textContent = '';
  const child = this.deserialize(this.initialState[0]);
  child.style.width = `${this.width}px`;
  child.style.height = `${this.height}px`;
  this.host.appendChild(child);
  for (const a of this.initialState[1]) {
    this.doAction(a);
  }
  this.notifyPossibleFocusChange();
};

const DOMRecStylesheetCache = {};

DOMReplay.prototype.deserialize = function (obj): HTMLElement {
  let node: HTMLElement;
  if ('' in obj) {
    node = this.hostDoc.createElement(obj['']);
    if (obj?.a) {
      // eslint-disable-next-line guard-for-in
      for (const a in obj.a) {
        if (a === 'cached' && obj[''] === 'STYLE') {
          if (DOMRecStylesheetCache[obj.a[a]]) {
            node.textContent = DOMRecStylesheetCache[obj.a[a]];
          }
          continue;
        }
        if (a === 'fakefocus') {
          this.maybeFocusedElement = node;
          this.maybeFocusedElementChanged = true;
        }
        node.setAttribute(a, obj.a[a]);
      }
    }
    if ('c' in obj) {
      for (const c of obj.c) {
        node.appendChild(this.deserialize(c));
      }
    }
  } else if ('d' in obj) {
    node = this.hostDoc.createTextNode(obj.d);
  } else {
    node = this.hostDoc.createTextNode('');
  }
  this.nodes[obj.id] = node;
  return node;
};

DOMReplay.prototype.node = function (id): null | HTMLElement | never {
  if (id == null) {
    return null;
  }
  if (id in this.nodes) {
    return this.nodes[id];
  }
  throw new Error(`Unknown ID ${id}`);
};

DOMReplay.prototype.setCursorPos = function (x, y): void {
  this.cursor.style.left = `${x}px`;
  this.cursor.style.top = `${y}px`;
  if (!this.cursor.parentNode) {
    this.host.appendChild(this.cursor);
  }
};

DOMReplay.prototype.step = function (): any {
  const action = this.actions[this.index++];
  this.doAction(action);
  this.notifyPossibleFocusChange();
  return action;
};

DOMReplay.prototype.setupFrame = function (frame): void {
  frame.contentDocument.body.remove();
  frame.contentDocument.documentElement.appendChild(frame.DOMRecBody);
  this.notifyPossibleFocusChange();
};

DOMReplay.prototype.notifyPossibleFocusChange = function (): void {
  if (!this.maybeFocusedElementChanged) {
    return;
  }
  this.maybeFocusedElementChanged = false;
  if (this.caretElement) {
    this.caretElement.remove();
    this.caretElement = null;
  }
  if (
    this.maybeFocusedElement &&
    this.maybeFocusedElement.hasAttribute('fakeFocus') &&
    this.maybeFocusedElement.ownerDocument.documentElement.contains(this.maybeFocusedElement)
  ) {
    this.setCaret(this.maybeFocusedElement);
  }
};

DOMReplay.prototype.doAction = function (action): void | never {
  if (DOMREC_MOUSE_MOVE in action) {
    const a = action[DOMREC_MOUSE_MOVE];
    this.setCursorPos(a[0], a[1]);
  } else if (DOMREC_DELAY in action || DOMREC_LABEL in action) {
    // do nothing
  } else if (DOMREC_ATTR in action) {
    const a = action[DOMREC_ATTR];
    const attr = a[1];
    const node = this.node(a[0]);
    if (typeof a[2] == 'string') {
      node.setAttribute(attr, a[2]);
      if (attr === 'fakefocus') {
        this.maybeFocusedElement = node;
        this.maybeFocusedElementChanged = true;
      }
    } else {
      node.removeAttribute(attr);
    }
  } else if (DOMREC_TEXT in action) {
    const a = action[DOMREC_TEXT];
    this.node(a[0]).data = a[1];
  } else if (DOMREC_ADD in action) {
    const a = action[DOMREC_ADD];
    this.node(a[0]).insertBefore(this.deserialize(a[2]), this.node(a[1]));
    for (const a3Action of a[3]) {
      this.doAction(a3Action);
    }
  } else if (DOMREC_REMOVE in action) {
    const n = action[DOMREC_REMOVE];
    const node = this.node(n);
    // XXX delete descendant nodes from our map too?
    delete this.nodes[n];
    node.remove();
  } else if (DOMREC_INPUT in action) {
    const a = action[DOMREC_INPUT];
    const n = this.node(a[0]);
    const v = a[1];
    if (v) {
      n.value = v;
    }
    this.maybeFocusedElementChanged = true;
  } else if (DOMREC_MOUSE_DOWN in action) {
    const a = action[DOMREC_MOUSE_DOWN];
    this.setCursorPos(a[0], a[1]);
    this.cursor.classList.add('down');
  } else if (DOMREC_MOUSE_UP in action) {
    const a = action[DOMREC_MOUSE_UP];
    this.setCursorPos(a[0], a[1]);
    this.cursor.classList.remove('down');
  } else if (DOMREC_FORCE_STYLE_FLUSH in action) {
    const n = action[DOMREC_FORCE_STYLE_FLUSH];
    this.node(n).getBoundingClientRect();
  } else if (DOMREC_SCROLL in action) {
    const a = action[DOMREC_SCROLL];
    const container = this.node(a[0]);
    if (container.getClientRects().length > 0) {
      const s = a[1];
      if (s === 'bottom') {
        container.scrollTop = 1000000;
      } else {
        const element = this.node(s);
        let o = element;
        let offsetY = 0;
        do {
          offsetY += o.offsetTop;
          o = o.offsetParent;
        } while (o !== container);
        const offsetHeight = element.offsetHeight;
        if (offsetY < o.scrollTop || offsetY + offsetHeight > o.scrollTop + o.clientHeight) {
          let y;
          if (a.length >= 3) {
            y = offsetY - a[2];
          } else {
            y = offsetY - (o.clientHeight - offsetHeight) / 2;
          }
          container.scrollTo(0, y);
        }
      }
    }
  } else if (DOMREC_FRAME in action) {
    const a = action[DOMREC_FRAME];
    const frame = this.node(a[0]);
    frame.DOMRecBody = this.deserialize(a[1]);
    if (frame.contentDocument.readyState === 'complete') {
      this.setupFrame(frame);
    } else {
      frame.addEventListener('load', () => {
        // Firefox might have destroyed our document due to loading "about:blank".
        // Restore it.
        this.setupFrame(frame);
      });
    }
  } else if (DOMREC_CANVAS_DATA in action) {
    const a = action[DOMREC_CANVAS_DATA];
    const n = this.node(a[0]);
    const img = new window.Image();
    n.loadingImage = img;

    img.addEventListener('load', (event): void => {
      // Check that the right image is drawing. If images decode out of
      // order we could have a problem.
      if (n.loadingImage === event.target) {
        n.getContext('2d').drawImage(img, 0, 0);
        n.loadingImage = null;
      }
      img.removeEventListener('load', onload);
    });
    img.setAttribute('src', a[1]);
  } else {
    throw new Error('Unknown action');
  }
};

DOMReplay.prototype.setCaret = function (element): void {
  // Create a fake caret for the text. We need to measure its position using hacks.
  // Currently we assume 'element' is a display:inline <input> or <textarea>.
  if (
    !(
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.hasAttribute('contenteditable')
    )
  ) {
    return;
  }

  const e = document.createElement('DIV');
  e.classList.add('fakeInput');
  e.style.left = `${element.offsetLeft}px`;
  e.style.top = `${element.offsetTop}px`;
  e.style.width = `${element.offsetWidth}px`;
  const pixels = (v: string): number =>
    v.endsWith('px') ? parseInt(v.substring(0, v.length - 2), 10) : 0;
  const cs = window.getComputedStyle(element);
  const fixPadding = (direction): void => {
    e.style[`padding${direction}`] = `${
      pixels(cs[`border${direction}Width`]) + pixels(cs[`padding${direction}`])
    }px`;
  };
  fixPadding('Left');
  fixPadding('Top');
  fixPadding('Right');
  fixPadding('Bottom');
  ['fontFamily', 'fontSize', 'verticalAlign', 'wordWrap', 'whiteSpace'].forEach(styleProperty => {
    e.style[styleProperty] = cs[styleProperty];
  });
  if (cs.display === 'inline-block' || cs.display === 'inline') {
    const baselineMeasurer = document.createElement('DIV');
    baselineMeasurer.classList.add('baselineMeasurer');
    element.parentNode.insertBefore(baselineMeasurer, element);
    const baselineRect = baselineMeasurer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    baselineMeasurer.remove();
    // Create an empty span to push the text baseline down to where it needs to be
    const span = document.createElement('span');
    span.style.height = `${(baselineRect.bottom - elementRect.top) / this.scaleY}px`;
    e.appendChild(span);
  }
  let value = 'value' in element ? element.value : element.textContent;
  const textIndex = value.length;
  // Work around https://bugs.chromium.org/p/chromium/issues/detail?id=839987.
  // If the value is entirely whitespace then we might need more workarounds but
  // that doesn't happen currently.
  if (value === '') {
    value = '|';
  }
  e.appendChild(document.createTextNode(value));

  const parent = element.offsetParent
    ? element.offsetParent
    : element.ownerDocument.documentElement;
  parent.appendChild(e);

  const r = new Range();
  r.setStart(e.lastChild, textIndex);
  r.collapse(true);
  const rangeRect = r.getClientRects()[0];
  const parentRect = parent.getBoundingClientRect();
  const caret = document.createElement('DIV') as any;
  caret.classList.add('fakeCaret');
  caret.style.left = `${(rangeRect.left - parentRect.left) / this.scaleX}px`;
  caret.style.top = `${(rangeRect.top - parentRect.top) / this.scaleY}px`;
  caret.style.height = `${rangeRect.height / this.scaleY}px`;
  caret.inputElement = element;

  e.remove();
  parent.appendChild(caret);
  this.caretElement = caret;
};

DOMReplay.prototype.labelIndex = function (name, def): number | any | never {
  if (typeof name == 'undefined') {
    return def;
  }
  for (let i = 0; i < this.actions.length; ++i) {
    if (this.actions[i][DOMREC_LABEL] === name) {
      return i;
    }
  }
  throw new Error(`Unknown label ${name}`);
};

function setTitle(d): void {
  if (d.hasAttribute('popOut')) {
    if (d.classList.contains('poppedOut')) {
      d.title = 'Click outside to shrink';
    } else {
      d.title = 'Click to enlarge';
    }
  } else if (d.classList.contains('DOMRecMovie')) {
    if (d.classList.contains('playing')) {
      d.title = 'Click to pause';
    } else {
      d.title = 'Click to resume';
    }
  } else {
    d.title = '';
  }
}

DOMReplay.prototype.stop = function (): void {
  if (this.pendingTimeout != null) {
    clearTimeout(this.pendingTimeout);
    this.pendingTimeout = null;
  }
  this.hostElem.classList.remove('playing');
  setTitle(this.hostElem);
};

DOMReplay.prototype.stopped = function (): boolean {
  return this.pendingTimeout === null;
};

DOMReplay.prototype.seekInternal = function (index: number): void {
  if (this.index > index) {
    this.reset();
  }
  while (this.index < index) {
    this.step();
  }
};

DOMReplay.prototype.seek = function (name): void {
  const index = this.labelIndex(name, 0);
  this.stop();
  this.seekInternal(index);
};

DOMReplay.prototype.play = function (options): void {
  this.stop();
  let stopAtIndex = this.actions.length;
  if (options && 'end' in options) {
    stopAtIndex = this.labelIndex(options.end);
  }
  let loop = !!(options && options.loop);
  const loopToIndex = 0;
  let timeScale = 1.0;
  if (options && 'timeScale' in options) {
    timeScale = options.timeScale;
  }
  const playStart = Date.now();
  let playTime = 0;
  let oneLoopTime = 0;
  if (loop) {
    for (let i = loopToIndex; i < stopAtIndex; ++i) {
      const action = this.actions[i];
      if (DOMREC_DELAY in action) {
        oneLoopTime += action[DOMREC_DELAY];
      }
    }
    if (oneLoopTime <= 0) {
      loop = false;
    }
  }
  const doPlay = (): void => {
    this.pendingTimeout = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.index >= stopAtIndex) {
        if (loop) {
          const delay = Date.now() - playStart;
          while (delay > timeScale * (playTime + oneLoopTime)) {
            // Fake playing some loops without doing the work to catch up to real time
            playTime += oneLoopTime;
          }
          this.hostElem.classList.add('looping');
          setTimeout(() => {
            this.hostElem.classList.remove('looping');
          }, 500);
          this.seekInternal(loopToIndex);
        } else {
          break;
        }
      }
      const action = this.step();
      if (DOMREC_DELAY in action) {
        playTime += action[DOMREC_DELAY];
        const delay = Date.now() - playStart;
        if (delay < timeScale * playTime) {
          this.pendingTimeout = setTimeout(doPlay, timeScale * playTime - delay);
          break;
        }
      }
    }
  };
  this.hostElem.classList.add('playing');
  setTitle(this.hostElem);
  doPlay();
};

// List URLs explicitly here so use_content_hashes can
// rewrite them to point to content-hashes.
const DOMREC_REPLAY_FRAME_STYLESHEETS = {
  'source-viewer.css': '/client/source-viewer.css?1',
  'editor.main.css': '/client/monaco-editor/min/vs/editor/editor.main.css?1',
  'pml.css': '/client/pml.css?1'
};
const DOMREC_REPLAY_STYLESHEETS = [
  '/client/main.css',
  '/client/pml.css',
  '/client/domrec-replay.css'
];
// Full URL of the current script
const DOMRecScriptURL = (document as any).currentScript?.src || null;

function rewriteResourceURL(url: string): string | never {
  if (url.startsWith('https://')) {
    // URL was rewritten by use_content_hashes already. Just use it.
    return url;
  }
  // This script is under js/domrec.js, so trim that off and append the URL
  // (after trimming /client)
  if (!DOMRecScriptURL.endsWith('/js/domrec.js')) {
    throw new Error(`Invalid script URL ${DOMRecScriptURL}`);
  }
  return DOMRecScriptURL.substring(0, DOMRecScriptURL.length - 13) + url.substring(7);
}

function DOMSetupReplay(element): boolean {
  const data = window[element.id] as any;
  if (!('initialState' in data)) {
    return false;
  }
  element.textContent = '';
  const frame = document.createElement('iframe') as any;
  let srcdoc = '<html class="replay"><head>';
  for (let sheet of DOMREC_REPLAY_STYLESHEETS) {
    sheet = rewriteResourceURL(sheet);
    srcdoc += `<link rel="stylesheet" href="${sheet}">`;
  }
  srcdoc +=
    '<link href="https://fonts.googleapis.com/css?family=Open+Sans:400,300,700,800,600" rel="stylesheet"></head>';
  frame.srcdoc = srcdoc;
  // Crazy hack to get the correct size for the IFRAME. We insert an SVG element
  // with the correct aspect ratio and let its intrinsic height be the height of our
  // DIV, then make the IFRAME use that height. Too bad there's no way to tell an IFRAME
  // to use a specific intrinsic ratio.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (
    window.origin === 'http://127.0.0.1:3000' &&
    (element.style.width !== `${data.width}px` || element.style.height !== `${data.height}px`)
  ) {
    alert(
      `Invalid dimensions for ${element.id}: expected ${data.width}px x ${data.height}px, got ${element.style.width} x ${element.style.height}`
    );
  }
  svg.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);
  element.appendChild(svg);
  element.appendChild(frame);
  // IFRAME navigation to the srcdoc document will have started but for now
  // we will have a blank document. Make sure this doesn't confuse us.
  frame.contentDocument.initialDoc = true;
  element.frame = frame;

  if (!element.hasAttribute('fixedWidth')) {
    element.style.maxWidth = `${data.width}px`;
    element.style.width = '';
  }
  element.style.height = '';
  return true;
}
let DOMResolveSetupReplay;
const DOMSetupReplayPromise = new Promise(resolve => {
  DOMResolveSetupReplay = resolve;
});

function DOMSetupReplayAll(): boolean | never {
  if (
    Array.from(document.querySelectorAll('.DOMRecScreenshot'))
      .concat(Array.from(document.querySelectorAll('.DOMRecMovie:not(.demo)')))
      .find(screenshotEl => DOMSetupReplay(screenshotEl))
  ) {
    return false;
  }
  DOMResolveSetupReplay();
  return true;
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!DOMSetupReplayAll()) {
      throw new Error('Data missing');
    }
  });
} else {
  if (!DOMSetupReplayAll()) {
    // The script with the DOMRec data hasn't loaded yet.
    const s = document.currentScript.previousElementSibling;
    if (s.tagName !== 'SCRIPT') {
      throw new Error('Expected DOMRec data script!');
    }
    s.addEventListener('load', () => {
      if (!DOMSetupReplayAll()) {
        throw new Error('Data missing');
      }
    });
  }
}

function DOMReplayStylesheetCacheLoaded(): void {
  function onloaded(element, callback): void {
    if (!element.frame) {
      return;
    }
    const waitForFonts = (): void => element.frame.contentDocument.fonts.ready.then(callback);
    const doc = element.frame.contentDocument;
    if (doc.readyState === 'complete' && !doc.initialDoc) {
      waitForFonts();
    } else {
      element.frame.addEventListener('load', waitForFonts);
    }
  }

  function createFullscreenButton(d): void {
    if (!document.fullscreenEnabled) {
      return;
    }
    const fullscreen = document.createElement('button');
    fullscreen.className = 'fullscreen';
    fullscreen.title = 'Click to enter/exit fullscreen';
    fullscreen.addEventListener('click', event => {
      event.stopPropagation();
      if (document.fullscreenElement === d) {
        document.exitFullscreen();
      } else {
        const resize = (): void => {
          const cw = d.clientWidth;
          const ch = d.clientHeight;
          const data = window[d.id] as any;
          if (data.width * ch < data.height * cw) {
            d.frame.style.top = '0';
            d.frame.style.height = '100%';
            const w = data.width * (ch / data.height);
            d.frame.style.width = `${w}px`;
            d.frame.style.left = `calc(50% - ${w / 2}px)`;
          } else {
            d.frame.style.left = '0';
            d.frame.style.width = '100%';
            const h = data.height * (cw / data.width);
            d.frame.style.height = `${h}px`;
            d.frame.style.top = `calc(50% - ${h / 2}px)`;
          }
        };
        let addedResizeListener = false;
        d.requestFullscreen().then(() => {
          resize();
          if (!addedResizeListener) {
            addedResizeListener = true;
            window.addEventListener('resize', resize);
          }
        });
      }
    });
    d.appendChild(fullscreen);
  }

  function tryPopOut(d, event): boolean {
    if (
      !d.hasAttribute('popOut') ||
      d.classList.contains('poppedOut') ||
      document.fullscreenElement === d
    ) {
      return false;
    }
    event.stopPropagation();

    const container = d.parentNode;
    const dRect = d.getBoundingClientRect();
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (window.getComputedStyle(d).position === 'absolute') {
      const savedMinHeight = container.style.minHeight;
      container.style.minHeight = '0';
      const containerRect = container.getBoundingClientRect();
      const newDWidth = 220 + containerRect.width;
      const newDHeight = (newDWidth * dRect.height) / dRect.width;
      container.style.height = `${containerRect.height}px`;
      container.getBoundingClientRect();
      d.classList.add('poppedOut');
      container.style.height = `${containerRect.height + newDHeight + 20}px`;
      d.style.width = `${newDWidth}px`;
      d.style.top = `${containerRect.height + 10}px`;
      d.escapeHandler = (escapeEvent): void => {
        if (!d.contains(escapeEvent.target)) {
          document.removeEventListener('click', d.escapeHandler, true);
          d.classList.remove('poppedOut');
          container.style.height = '';
          container.style.minHeight = savedMinHeight;
          d.style.width = '';
          d.style.top = '';
          setTitle(d);
          // Don't stop propagation; allow the click to function normally
        }
      };
    } else {
      const containerRect = container.getBoundingClientRect();
      const newDWidth = containerRect.width;
      d.classList.add('poppedOut');
      d.style.left = '0';
      d.style.width = `${newDWidth}px`;
      d.escapeHandler = (escapeEvent): void => {
        if (!d.contains(escapeEvent.target)) {
          document.removeEventListener('click', d.escapeHandler, true);
          d.classList.remove('poppedOut');
          d.style.left = '';
          d.style.width = '';
          setTitle(d);
          // Don't stop propagation; allow the click to function normally
        }
      };
    }

    document.addEventListener('click', d.escapeHandler, true);
    setTitle(d);
    return true;
  }

  function setupScreenshotReplay(d): void {
    d.player = new DOMReplay(d);
    createFullscreenButton(d);
    d.addEventListener('click', event => {
      if (tryPopOut(d, event)) {
        return;
      }
      if (document.fullscreenElement === d) {
        document.exitFullscreen();
        event.stopPropagation();
      }
    });
    setTitle(d);
  }
  Array.from(document.querySelectorAll('.DOMRecScreenshot')).forEach(screenshotEl => {
    onloaded(screenshotEl, () => setupScreenshotReplay(screenshotEl));
  });

  function setupMovieReplay(d): void {
    d.player = new DOMReplay(d);
    const replayIndicator = document.createElement('div');
    d.appendChild(replayIndicator);
    const play = document.createElement('button');
    play.className = 'play';
    d.appendChild(play);
    createFullscreenButton(d);
    d.addEventListener('click', event => {
      if (tryPopOut(d, event)) {
        return;
      }
      event.stopPropagation();
      if (d.player.stopped()) {
        d.player.play({ loop: true });
      } else {
        d.player.stop();
      }
    });
    setTitle(d);
  }
  Array.from(document.querySelectorAll('.DOMRecMovie:not(.demo)')).forEach(demo => {
    onloaded(demo, () => setupMovieReplay(demo));
  });

  window.addEventListener('click', ({ target, preventDefault, stopPropagation }: MouseEvent) => {
    if ((target as any).classList.contains('DOMRecShowDemo')) {
      const demo = (target as any).nextSibling;
      (demo as any).classList.toggle('show');
      if (demo.player) {
        if (demo.classList.contains('show')) {
          demo.player.play({ loop: true });
        } else {
          demo.player.stop();
        }
      } else {
        DOMSetupReplay(demo);
        onloaded(demo, () => {
          setupMovieReplay(demo);
          demo.player.play({ loop: true });
        });
      }

      preventDefault();
      stopPropagation();
    }
  });
}

function DOMReplayLoadStylesheets(): void {
  if (!DOMRecScriptURL) {
    // We were injected, not loaded, so just bail out.
    return;
  }
  // The ?1 suffix distinguishes this resource from non-CORS direct loads, to
  // ensure the results are cached separately. Cloudfront/S3 doesn't set CORS
  // headers on non-CORS loads.
  const promises = [DOMSetupReplayPromise];
  Object.values(DOMREC_REPLAY_FRAME_STYLESHEETS).forEach(stylesheet => {
    const cached = stylesheet;
    const url = rewriteResourceURL(stylesheet);
    promises.push(
      window
        .fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.statusText}`);
          }
          return response.text();
        })
        .then(text => {
          if (typeof text != 'string') {
            throw new Error(`Unexpected source text: ${text}`);
          }
          DOMRecStylesheetCache[cached] = text;
        })
    );
  });
  Promise.all(promises).then(DOMReplayStylesheetCacheLoaded);
}
DOMReplayLoadStylesheets();

window.addEventListener('load', () => {
  document.body.classList.add('loaded');
});
