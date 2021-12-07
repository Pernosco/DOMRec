import {
  DOMREC_CANVAS_DATA,
  DOMREC_FORCE_STYLE_FLUSH,
  DOMREC_INPUT,
  DOMREC_MOUSE_DOWN,
  DOMREC_MOUSE_MOVE,
  DOMREC_MOUSE_UP
} from './constants';

export class DOMRecFrame {
  public observer: MutationObserver;
  public initialState: any[];

  constructor(public win: Window, public node: any, public rec: any, public iframeElement: any) {
    node.ownerDocument.DOMRecInner = this;

    const actions = [];
    const serializedNode = rec.serializeNode(node, actions);
    if (!serializedNode) {
      throw new Error(`Can't record element ${node.tagName}`);
    }
    this.initialState = [serializedNode, actions];
    this.observer = new MutationObserver(rec.observerCallback);
    this.observer.observe(node, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });

    win.addEventListener('input', this.inputListener, { capture: true, passive: true });
    win.addEventListener('mousemove', this.mouseListener, { capture: true, passive: true });
    win.addEventListener('mousedown', this.mouseListener, { capture: true, passive: true });
    win.addEventListener('mouseup', this.mouseListener, { capture: true, passive: true });
    win.addEventListener('forceStyleFlush', this.flushListener, { capture: true, passive: true });
    win.addEventListener('didDrawCanvas', this.canvasListener, { capture: true, passive: true });
    win.addEventListener('focus', this.focusListener, { capture: true, passive: true });
  }

  public prepEvent = (event): number => {
    this.flushObserver();
    return event.target?.DOMRecID || 0;
  };

  public mouseListener = (event): void | never => {
    let x = event.clientX;
    let y = event.clientY;
    let frameElem = this.iframeElement;
    let target = event.target;
    let mouseEventNode = this.node;
    // Translate to root document coordinates.
    while (frameElem) {
      const frameRect = frameElem.getBoundingClientRect();
      // XXX assumes no border/padding on the IFRAME. handling that is a pain.
      x += frameRect.left;
      y += frameRect.top;
      target = frameElem;
      const nextInner = frameElem.ownerDocument.DOMRecInner;
      mouseEventNode = nextInner.node;
      frameElem = nextInner.iframeElement;
    }
    if (!mouseEventNode.contains(target)) {
      return;
    }
    this.flushObserver();
    const nodeRect = mouseEventNode.getBoundingClientRect();
    x -= nodeRect.left;
    y -= nodeRect.top;
    let key;
    switch (event.type) {
      case 'mousemove':
        key = DOMREC_MOUSE_MOVE;
        break;
      case 'mouseup':
        key = DOMREC_MOUSE_UP;
        break;
      case 'mousedown':
        key = DOMREC_MOUSE_DOWN;
        break;
      default:
        throw new Error(`Unknown event type: ${event.type}`);
    }
    this.rec.actions.push({ [key]: [Math.round(x), Math.round(y)] });
  };

  public scrollListener = (event): void => {
    if (!this.node.contains(event.target)) {
      return;
    }
    const id = this.prepEvent(event);
    if (id) {
      this.rec.pushScrollAction(id, event.target);
    }
  };

  public inputListener = (event): void => {
    if (!this.node.contains(event.target)) {
      return;
    }
    const id = this.prepEvent(event);
    if (id) {
      let value = null;
      // For contenteditable elements, the DOM changes will just
      // be recorded and we don't have to do anything here except
      // record an input event so the caret can be updated.
      if ('value' in event.target) {
        value = event.target.value;
      }
      // eslint-disable-next-line no-console
      console.log(value, 'just in order to have tsc tolerating the unused variable for now');
      this.rec.actions.push({
        [DOMREC_INPUT]: [id, event.target.value]
      });
    }
  };

  public flushListener = (event): void => {
    if (!this.node.contains(event.target)) {
      return;
    }
    const id = this.prepEvent(event);
    if (id) {
      this.rec.actions.push({
        [DOMREC_FORCE_STYLE_FLUSH]: id
      });
    }
  };

  public stop(): void {
    this.flushObserver();
    this.observer.disconnect();
    this.win.removeEventListener('input', this.inputListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('mousemove', this.mouseListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('mousedown', this.mouseListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('mouseup', this.mouseListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('forceStyleFlush' as any, this.flushListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('didDrawCanvas' as any, this.canvasListener, {
      capture: true,
      passive: true
    } as any);
    this.win.removeEventListener('focus', this.focusListener, {
      capture: true,
      passive: true
    } as any);
    this.rec.deleteAllDOMRecIDs(this.node);
  }

  public canvasListener = (event): void => {
    if (!this.node.contains(event.target)) {
      return;
    }
    const id = this.prepEvent(event);
    if (id) {
      this.rec.actions.push({
        [DOMREC_CANVAS_DATA]: [id, event.target.toDataURL(), 'didDraw']
      });
    }
  };

  public focusListener = (): void => this.rec.evaluateFocus();

  public flushObserver(): void {
    this.rec.observerCallback(this.observer.takeRecords());
  }
}
