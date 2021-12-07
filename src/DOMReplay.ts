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

export class DOMReplay {
  public initialState: any;
  public actions: any;
  public width: number;
  public height: number;
  public hostElem: any;
  public hostDoc: Document;
  public host: HTMLElement;
  public index: number;
  public scaleX: number;
  public scaleY: number;
  public nodes: Record<string, any>;
  public cursor: HTMLDivElement;
  public DOMRecStylesheetCache: any = (window as any).DOMRecStylesheetCache;
  public pendingTimeout: any = null;
  public caretElement: any = null;
  public maybeFocusedElement: any = null;
  public maybeFocusedElementChanged = false;

  constructor(hostElem: any) {
    const state = window[hostElem.id] as any;
    this.initialState = state.initialState;
    this.actions = state.actions;
    this.width = state.width;
    this.height = state.height;
    this.hostElem = hostElem;
    const hostFrame = hostElem.lastChild as HTMLIFrameElement;
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

    const resize = (): void => {
      const margin = 2;
      this.scaleX = (this.hostDoc.defaultView.innerWidth - 2 * margin) / state.width;
      this.scaleY = (this.hostDoc.defaultView.innerHeight - 2 * margin) / state.height;
      this.hostDoc.body.style.transform = `translate(2px, 2px) scale(${this.scaleX},${this.scaleY})`;
    };
    resize();
    hostFrame.contentWindow.addEventListener('resize', resize);
  }

  public reset(): void {
    this.index = 0;
    this.nodes = {};
    this.host.textContent = '';
    const child = this.deserialize(this.initialState[0]) as HTMLElement;
    child.style.width = `${this.width}px`;
    child.style.height = `${this.height}px`;
    this.host.appendChild(child);
    for (const a of this.initialState[1]) {
      this.doAction(a);
    }
    this.notifyPossibleFocusChange();
  }

  public notifyPossibleFocusChange(): void {
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
  }

  public deserialize(obj): HTMLElement | Text {
    if ('' in obj) {
      const htmlNode = this.hostDoc.createElement(obj['']) as HTMLElement;
      if (obj?.a) {
        // eslint-disable-next-line guard-for-in
        for (const a in obj.a) {
          if (a === 'cached' && obj[''] === 'STYLE') {
            if (this.DOMRecStylesheetCache[obj.a[a]]) {
              htmlNode.textContent = this.DOMRecStylesheetCache[obj.a[a]];
            }
            continue;
          }
          if (a === 'fakefocus') {
            this.maybeFocusedElement = htmlNode;
            this.maybeFocusedElementChanged = true;
          }
          htmlNode.setAttribute(a, obj.a[a]);
        }
      }
      if ('c' in obj) {
        for (const c of obj.c) {
          htmlNode.appendChild(this.deserialize(c));
        }
      }
      this.nodes[obj.id] = htmlNode;
      return htmlNode;
    }
    if ('d' in obj) {
      const textNodeD = this.hostDoc.createTextNode(obj.d);
      this.nodes[obj.id] = textNodeD;
      return textNodeD;
    }
    const textNode = this.hostDoc.createTextNode('');
    this.nodes[obj.id] = textNode;
    return textNode;
  }

  public node(id): null | any | never {
    if (id == null) {
      return null;
    }
    if (id in this.nodes) {
      return this.nodes[id];
    }
    throw new Error(`Unknown ID ${id}`);
  }

  public setCursorPos(x, y): void {
    this.cursor.style.left = `${x}px`;
    this.cursor.style.top = `${y}px`;
    if (!this.cursor.parentNode) {
      this.host.appendChild(this.cursor);
    }
  }

  public step(): any {
    const action = this.actions[this.index++];
    this.doAction(action);
    this.notifyPossibleFocusChange();
    return action;
  }
  public setupFrame(frame): void {
    frame.contentDocument.body.remove();
    frame.contentDocument.documentElement.appendChild(frame.DOMRecBody);
    this.notifyPossibleFocusChange();
  }
  public doAction(action): void | never {
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
      if (this.node(a[0])) {
        this.node(a[0]).data = a[1];
      }
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
  }
  public setCaret(element): void {
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
  }

  public labelIndex(name, def?): number | any | never {
    if (typeof name === 'undefined') {
      return def;
    }
    for (let i = 0; i < this.actions.length; ++i) {
      if (this.actions[i][DOMREC_LABEL] === name) {
        return i;
      }
    }
    throw new Error(`Unknown label ${name}`);
  }

  public stop(): void {
    if (this.pendingTimeout != null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.hostElem.classList.remove('playing');
    setTitle(this.hostElem);
  }

  public stopped(): boolean {
    return this.pendingTimeout === null;
  }

  public seekInternal(index: number): void {
    if (this.index > index) {
      this.reset();
    }
    while (this.index < index) {
      this.step();
    }
  }

  public seek(name): void {
    const index = this.labelIndex(name, 0);
    this.stop();
    this.seekInternal(index);
  }

  public play(options): void {
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
  }
}
