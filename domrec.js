/* Copyright Pernosco 2020. See LICENSE. */

const DOMREC_ADD = "a";
const DOMREC_CANVAS_DATA = "c";
const DOMREC_DELAY = "d";
const DOMREC_FRAME = "e";
const DOMREC_FORCE_STYLE_FLUSH = "f";
const DOMREC_INPUT = "i";
const DOMREC_LABEL = "l";
const DOMREC_MOUSE_MOVE = "m";
const DOMREC_MOUSE_DOWN = "n";
const DOMREC_ATTR = "r";
const DOMREC_TEXT = "t";
const DOMREC_MOUSE_UP = "u";
const DOMREC_REMOVE = "v";
const DOMREC_SCROLL = "s";

// If an element has the "hidden" class and its ID is in this list,
// assume it won't be needed for the replay and just ignore the node
// completely.
window.DOMREC_SKIP_HIDDEN_IDS = ['toolbox'];

// XXX Currently we assume all scrollable elements are one of PRE/DIV/INPUT/TEXTAREA

function DOMRecFrame(win, node, rec, iframeElement) {
  this.win = win;
  this.node = node;
  this.rec = rec;
  this.iframeElement = iframeElement;
  node.ownerDocument.DOMRecInner = this;

  let prepEvent = (function(event) {
    this.flushObserver();
    if ("DOMRecID" in event.target) {
      return event.target.DOMRecID;
    }
    return 0;
  }).bind(this);

  this.inputListener = (function(event) {
      if (!this.node.contains(event.target)) {
        return;
      }
      let id = prepEvent(event);
      if (id) {
        let a = {};
        let value = null;
        // For contenteditable elements, the DOM changes will just
        // be recorded and we don't have to do anything here except
        // record an input event so the caret can be updated.
        if ("value" in event.target) {
          value = event.target.value;
        }
        a[DOMREC_INPUT] = [id, event.target.value];
        this.rec.actions.push(a);
      }
    }).bind(this);
  this.mouseListener = (function(event) {
      let x = event.clientX;
      let y = event.clientY;
      let frameElem = this.iframeElement;
      let target = event.target;
      let node = this.node;
      // Translate to root document coordinates.
      while (frameElem) {
        let frameRect = frameElem.getBoundingClientRect();
        // XXX assumes no border/padding on the IFRAME. handling that is a pain.
        x += frameRect.left;
        y += frameRect.top;
        target = frameElem;
        let nextInner = frameElem.ownerDocument.DOMRecInner;
        node = nextInner.node;
        frameElem = nextInner.iframeElement;
      }
      if (!node.contains(target)) {
        return;
      }
      this.flushObserver();
      let nodeRect = node.getBoundingClientRect();
      x -= nodeRect.left;
      y -= nodeRect.top;
      let key;
      switch (event.type) {
        case "mousemove": key = DOMREC_MOUSE_MOVE; break;
        case "mouseup": key = DOMREC_MOUSE_UP; break;
        case "mousedown": key = DOMREC_MOUSE_DOWN; break;
        default:
          throw "Unknown event type: " + event.type;
      }
      let a = {};
      a[key] = [Math.round(x), Math.round(y)];
      this.rec.actions.push(a);
    }).bind(this);
  this.flushListener = (function(event) {
    if (!this.node.contains(event.target)) {
      return;
    }
    let id = prepEvent(event);
    if (id) {
      let a = {};
      a[DOMREC_FORCE_STYLE_FLUSH] = id;
      this.rec.actions.push(a);
    }
  }).bind(this);
  this.canvasListener = (function(event) {
    if (!this.node.contains(event.target)) {
      return;
    }
    let id = prepEvent(event);
    if (id) {
      let a = {};
      a[DOMREC_CANVAS_DATA] = [id, event.target.toDataURL(), "didDraw"];
      this.rec.actions.push(a);
    }
  }).bind(this);
  this.focusListener = (function(event) {
    rec.evaluateFocus();
  }).bind(this);
  this.scrollListener = (function(event) {
    if (!this.node.contains(event.target)) {
      return;
    }
    let id = prepEvent(event);
    if (id) {
      this.rec.pushScrollAction(id, event.target);
    }
  }).bind(this);

  let actions = [];
  let serializedNode = rec.serializeNode(node, actions);
  if (!serializedNode) {
    throw "Can't record element " + node.tagName;
  }
  this.initialState = [serializedNode, actions];
  this.observer = new MutationObserver(rec.observerCallback);
  this.observer.observe(node, {attributes:true, characterData:true, childList:true, subtree:true});

  win.addEventListener("input", this.inputListener, {capture:true, passive:true});
  win.addEventListener("mousemove", this.mouseListener, {capture:true, passive:true});
  win.addEventListener("mousedown", this.mouseListener, {capture:true, passive:true});
  win.addEventListener("mouseup", this.mouseListener, {capture:true, passive:true});
  // Dispatch this event on an element when you want to flush styles on it and its descendants.
  win.addEventListener("forceStyleFlush", this.flushListener, {capture:true, passive:true});
  // Dispatch this event on a canvas element when you've drawn into it.
  win.addEventListener("didDrawCanvas", this.canvasListener, {capture:true, passive:true});
  win.addEventListener("focus", this.focusListener, {capture:true, passive:true});
}

DOMRecFrame.prototype.flushObserver = function() {
  this.rec.observerCallback(this.observer.takeRecords());
}

DOMRecFrame.prototype.stop = function() {
  this.flushObserver();
  this.observer.disconnect();
  this.win.removeEventListener("input", this.inputListener, {capture:true, passive:true});
  this.win.removeEventListener("mousemove", this.mouseListener, {capture:true, passive:true});
  this.win.removeEventListener("mousedown", this.mouseListener, {capture:true, passive:true});
  this.win.removeEventListener("mouseup", this.mouseListener, {capture:true, passive:true});
  this.win.removeEventListener("forceStyleFlush", this.flushListener, {capture:true, passive:true});
  this.win.removeEventListener("didDrawCanvas", this.canvasListener, {capture:true, passive:true});
  this.win.removeEventListener("focus", this.focusListener, {capture:true, passive:true});
  this.rec.deleteAllDOMRecIDs(this.node);
}

function DOMRec(node) {
  this.nextID = 1;
  this.actions = [];
  this.lastActionTime = Date.now();
  this.nestedObserverCallbacks = 0;
  this.observerCallback = this.callback.bind(this);
  this.iframeLoadedListener = (function(event) {
    this.iframeLoaded(event.target, this.actions);
  }).bind(this);
  this.rootFrame = new DOMRecFrame(window, node, this, null);
  this.focusedElement = null;
  this.evaluateFocus();
  this.rootFrame.initialState[1] = this.rootFrame.initialState[1].concat(this.actions);
  this.actions = [];
}

DOMRec.prototype.clearFakeFocus = function() {
  if (!this.focusedElement) {
    return;
  }
  this.focusedElement.removeAttribute("fakeFocus");
  let ancestor = this.focusedElement;
  while (ancestor) {
    ancestor.removeAttribute("fakeFocusWithin");
    let nextAncestor = ancestor.parentElement;
    if (!nextAncestor) {
      ancestor = ancestor.ownerDocument.DOMRecInner.iframeElement;
    } else {
      ancestor = nextAncestor;
    }
  }
}

DOMRec.prototype.evaluateFocus = function() {
  let frame = this.rootFrame;
  let e;
  while (true) {
    e = frame.win.document.activeElement;
    if (!frame.node.contains(e)) {
      e = null;
      break;
    }
    if (e.tagName == "IFRAME") {
      frame = e.contentDocument.DOMRecInner;
    } else {
      break;
    }
  }
  if (e == this.focusedElement) {
    return;
  }
  this.clearFakeFocus();
  e.setAttribute("fakeFocus", "");
  let ancestor = e;
  while (ancestor) {
    ancestor.setAttribute("fakeFocusWithin", "");
    let nextAncestor = ancestor.parentElement;
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

DOMRec.prototype.stop = function() {
  let width = this.rootFrame.node.getBoundingClientRect().width;
  let height = this.rootFrame.node.getBoundingClientRect().height;
  let ret = {initialState: this.rootFrame.initialState, actions: this.actions, width: width, height: height};
  this.rootFrame.stop();
  this.clearFakeFocus();
  this.rootFrame = null;
  return ret;
}

DOMRec.prototype.allowAttribute = function(e, name) {
  switch (name) {
    case "src":
    case "srcdoc":
      if (e.tagName == "IFRAME") {
        return false;
      }
      break;
    case "title":
      return false;
  }
  return true;
}

DOMRec.prototype.pushScrollAction = function(id, element, actionsList) {
  let actions = actionsList ? actionsList : this.actions;
  let scrolledIntoView = element.elementScrolledIntoView;
  if (scrolledIntoView) {
    let a = {};
    if (scrolledIntoView.DOMRecID) {
      let scrolledIntoViewOffset = "elementScrolledIntoViewOffset" in element ? element.elementScrolledIntoViewOffset : null;
      a[DOMREC_SCROLL] = [id, scrolledIntoView.DOMRecID, scrolledIntoViewOffset];
    } else {
      if (scrolledIntoView != "bottom") {
        throw "Unknown scrolledIntoView: " + scrolledIntoView;
      }
      a[DOMREC_SCROLL] = [id, scrolledIntoView];
    }
    actions.push(a);
  } else {
    console.log("Warning: unknown scroll operation ignored");
  }
}

DOMRec.prototype.serializeNode = function(node, actions) {
  if ("DOMRecID" in node) {
    throw "Already serialized " + node.DOMRecID;
  }
  let id = this.nextID++;
  let obj = {id:id};
  node.DOMRecID = id;
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      let tag = node.tagName;
      switch (tag) {
        case "INPUT":
        case "TEXTAREA": {
          let a = {};
          a[DOMREC_INPUT] = [id, node.value];
          actions.push(a);
          let listener = node.ownerDocument.DOMRecInner.scrollListener;
          node.addEventListener("scroll", listener, {passive:true});
          break;
        }
        case "PRE":
        case "DIV": {
          if (node.classList.contains("hidden") &&
            DOMREC_SKIP_HIDDEN_IDS.indexOf(node.id) >= 0) {
            delete node.DOMRecID;
            return null;
          }
          let listener = node.ownerDocument.DOMRecInner.scrollListener;
          node.addEventListener("scroll", listener, {passive:true});
          break;
        }
        case "SCRIPT":
        case "LINK":
          delete node.DOMRecID;
          return null;
        case "CANVAS": {
          let a = {};
          a[DOMREC_CANVAS_DATA] = [id, node.toDataURL()];
          actions.push(a);
          break;
        }
        case "IFRAME":
          this.attachToIFrame(node, actions);
          break;
      }
      obj[""] = tag;
      let attrs = {};
      let hasAttr = false;
      for (let a of node.attributes) {
        let name = a.name;
        if (this.allowAttribute(node, name)) {
          attrs[name] = a.value;
          hasAttr = true;
        }
      }
      if (hasAttr) {
        obj.a = attrs;
      }
      let children = [];
      for (let c of node.childNodes) {
        let serialized = this.serializeNode(c, actions);
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
      let data = node.data;
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
      throw "Bad node " + node;
  }
  return obj;
}

DOMRec.prototype.attachToIFrame = function(e, actions) {
  e.addEventListener("load", this.iframeLoadedListener);
  if (e.contentDocument && e.contentDocument.readyState == "complete") {
    this.iframeLoaded(e, actions);
  }
}

DOMRec.prototype.iframeLoaded = function(e, actions) {
  e.DOMRecInner = new DOMRecFrame(e.contentWindow, e.contentDocument.body, this, e);
  let bodyElement = e.DOMRecInner.initialState[0];
  if (!bodyElement.c) {
    bodyElement.c = [];
  }
  for (let c = e.contentDocument.head.firstElementChild; c; c = c.nextElementSibling) {
    if (c.tagName == "STYLE") {
      bodyElement.c.push(this.serializeNode(c, e.DOMRecInner.initialState[1]));
      this.deleteAllDOMRecIDs(c);
    } else if (c.tagName == "LINK" && c.getAttribute("rel") == "stylesheet") {
      let href = c.getAttribute("href");
      let lastSlash = href.lastIndexOf("/");
      if (lastSlash >= 0) {
        href = href.substring(lastSlash + 1);
      }
      let style = {
        "": "STYLE",
        a: { "cached": href },
        id: this.nextID++
      };
      bodyElement.c.push(style);
    }
  }
  let styles = {
    "": "STYLE",
    c: [{d:".scrollbar { opacity: 0 ! important }", id:this.nextID++}],
    id: this.nextID++
  };
  bodyElement.c.push(styles);
  let a = {};
  a[DOMREC_FRAME] = [e.DOMRecID, bodyElement];
  actions.push(a);
  for (let aa of e.DOMRecInner.initialState[1]) {
    actions.push(aa);
  }
  delete e.DOMRecInner.initialState;
}

DOMRec.prototype.detachFromIFrame = function(e) {
  // XXX not sure how this can be null
  if (e.DOMRecInner) {
    e.DOMRecInner.stop();
  }
  e.removeEventListener("load", this.iframeLoadedListener);
}

DOMRec.prototype.label = function(name) {
  this.callback(this.observer.takeRecords());
  let a = {};
  a[DOMREC_LABEL] = name;
  this.actions.push(a);
}

DOMRec.prototype.delay = function(seconds) {
  this.lastActionTime -= seconds*1000;
}

DOMRec.prototype.deleteAllDOMRecIDs = function(e) {
  delete e.DOMRecID;
  let listener = e.ownerDocument.DOMRecInner.scrollListener;
  e.removeEventListener("scroll", listener, {passive:true});
  for (let c = e.firstChild; c; c = c.nextSibling) {
    if (c.DOMRecID) {
      this.deleteAllDOMRecIDs(c);
    }
  }
  if (e.tagName == "IFRAME") {
    this.detachFromIFrame(e);
  }
}

DOMRec.prototype.callback = function(records, observer) {
  // Observer callbacks can nest when we flush while detaching from an IFRAME
  if (this.nestedObserverCallbacks == 0) {
    let now = Date.now();
    if (now > this.lastActionTime) {
      let a = {};
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

    for (let r of records) {
      if (r.target.DOMRecID && r.type == "childList") {
        for (let child of r.removedNodes) {
          let childID = child.DOMRecID;
          if (!childID) {
            continue;
          }
          let a = {};
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

    let nodesWithAddedChildren = [];
    for (let r of records) {
      let target = r.target;
      let id = target.DOMRecID;
      if (!id) {
        // Node not in non-excluded DOM at the start of the records batch.
        continue;
      }
      switch (r.type) {
        case "attributes": {
          let attributeName = r.attributeName;
          if (this.allowAttribute(target, attributeName)) {
            let a = {};
            a[DOMREC_ATTR] = [id, attributeName, target.getAttribute(attributeName)];
            this.actions.push(a);
          }
          break;
        }
        case "characterData": {
          let a = {};
          a[DOMREC_TEXT] = [id, target.data];
          this.actions.push(a);
          break;
        }
        case "childList": {
          if (r.addedNodes.length > 0 && !target.DOMRecNodesAdded) {
            target.DOMRecNodesAdded = true;
            nodesWithAddedChildren.push(target);
          }
        }
      }
    }

    for (let node of nodesWithAddedChildren) {
      delete node.DOMRecNodesAdded;
      for (let c = node.lastChild; c; c = c.previousSibling) {
        if (c.DOMRecID) {
          continue;
        }
        let a = {};
        let actions = [];
        let serializedNode = this.serializeNode(c, actions);
        if (!serializedNode) {
          continue;
        }
        let nextSibling = c.nextSibling;
        a[DOMREC_ADD] = [node.DOMRecID, nextSibling ? nextSibling.DOMRecID : null,
                        serializedNode, actions];
        this.actions.push(a);
      }
    }
  } catch (ex) {
    --this.nestedObserverCallbacks;
    console.log("MutationObserver exception: ", ex);
    throw ex;
  }

  --this.nestedObserverCallbacks;
  if (this.nestedObserverCallbacks == 0) {
    // Ignore time spent doing DOMRec recording.
    // Note that during this processing, the browser might be downloading stuff or
    // doing other off-main-thread work, so this could give an optimistic picture
    // of actual performance. Doesn't really matter.
    this.lastActionTime = Date.now();
  }
}

function DOMReplay(hostElem) {
  let state = window[hostElem.id];
  this.initialState = state.initialState;
  this.actions = state.actions;
  this.width = state.width;
  this.height = state.height;
  this.hostElem = hostElem;
  hostFrame = hostElem.lastChild;
  this.hostDoc = hostFrame.contentDocument;
  this.host = this.hostDoc.body;
  this.index = 0;
  this.scaleX = 1;
  this.scaleY = 1;
  this.nodes = {};
  this.cursor = this.hostDoc.createElement("div");
  let cursorImage = this.hostDoc.createElementNS("http://www.w3.org/2000/svg", "svg");
  cursorImage.setAttribute("viewBox", "0 0 320 512");
  cursorImage.innerHTML = '<path d="M302.189 329.126H196.105l55.831 135.993c3.889 9.428-.555 19.999-9.444 23.999l-49.165 21.427c-9.165 4-19.443-.571-23.332-9.714l-53.053-129.136-86.664 89.138C18.729 472.71 0 463.554 0 447.977V18.299C0 1.899 19.921-6.096 30.277 5.443l284.412 292.542c11.472 11.179 3.007 31.141-12.5 31.141z"/>';
  this.cursor.setAttribute("class", "mouseCursor");
  this.cursor.appendChild(cursorImage);
  this.reset();
  this.pendingTimeout = null;
  this.caretElement = null;
  this.maybeFocusedElement = null;
  this.maybeFocusedElementChanged = false;

  let resize = (function() {
    const margin = 2;
    this.scaleX = (this.hostDoc.defaultView.innerWidth - 2*margin)/state.width;
    this.scaleY = (this.hostDoc.defaultView.innerHeight - 2*margin)/state.height;
    this.hostDoc.body.style.transform = "translate(2px, 2px) scale(" + this.scaleX + "," + this.scaleY + ")";
  }).bind(this);
  resize();
  hostFrame.contentWindow.addEventListener("resize", resize);
}

DOMReplay.prototype.reset = function() {
  this.index = 0;
  this.nodes = {};
  this.host.textContent = "";
  let child = this.deserialize(this.initialState[0]);
  child.style.width = this.width + "px";
  child.style.height = this.height + "px";
  this.host.appendChild(child);
  for (let a of this.initialState[1]) {
    this.doAction(a);
  }
  this.notifyPossibleFocusChange();
}

let DOMRecStylesheetCache = {};

DOMReplay.prototype.deserialize = function(obj) {
  let node;
  if ("" in obj) {
    node = this.hostDoc.createElement(obj[""]);
    if ("a" in obj) {
      for (let a in obj.a) {
        if (a == "cached" && obj[""] == "STYLE") {
          let cached = DOMRecStylesheetCache[obj.a[a]];
          if (cached) {
            node.textContent = cached;
          }
          continue;
        }
        if (a == "fakefocus") {
          this.maybeFocusedElement = node;
          this.maybeFocusedElementChanged = true;
        }
        node.setAttribute(a, obj.a[a]);
      }
    }
    if ("c" in obj) {
      for (let c of obj.c) {
        node.appendChild(this.deserialize(c));
      }
    }
  } else if ("d" in obj) {
    node = this.hostDoc.createTextNode(obj.d);
  } else {
    node = this.hostDoc.createTextNode("");
  }
  this.nodes[obj.id] = node;
  return node;
}

DOMReplay.prototype.node = function(id) {
  if (id == null) {
    return null;
  }
  if (id in this.nodes) {
    return this.nodes[id];
  }
  throw "Unknown ID " + id;
}

DOMReplay.prototype.setCursorPos = function(x, y) {
  this.cursor.style.left = x + "px";
  this.cursor.style.top = y + "px";
  if (!this.cursor.parentNode) {
    this.host.appendChild(this.cursor);
  }
}

DOMReplay.prototype.step = function() {
  let action = this.actions[this.index++];
  this.doAction(action);
  this.notifyPossibleFocusChange();
  return action;
}

DOMReplay.prototype.setupFrame = function(frame) {
  frame.contentDocument.body.remove();
  frame.contentDocument.documentElement.appendChild(frame.DOMRecBody);
  this.notifyPossibleFocusChange();
}

DOMReplay.prototype.notifyPossibleFocusChange = function() {
  if (!this.maybeFocusedElementChanged) {
    return;
  }
  this.maybeFocusedElementChanged = false;
  if (this.caretElement) {
    this.caretElement.remove();
    this.caretElement = null;
  }
  if (this.maybeFocusedElement &&
      this.maybeFocusedElement.hasAttribute("fakeFocus") &&
      this.maybeFocusedElement.ownerDocument.documentElement.contains(this.maybeFocusedElement)) {
    this.setCaret(this.maybeFocusedElement);
  }
}

DOMReplay.prototype.doAction = function(action) {
  if (DOMREC_MOUSE_MOVE in action) {
    let a = action[DOMREC_MOUSE_MOVE];
    this.setCursorPos(a[0], a[1]);
  } else if (DOMREC_DELAY in action || DOMREC_LABEL in action) {
    // do nothing
  } else if (DOMREC_ATTR in action) {
    let a = action[DOMREC_ATTR];
    let attr = a[1];
    let node = this.node(a[0]);
    if (typeof a[2] == "string") {
      node.setAttribute(attr, a[2]);
      if (attr == "fakefocus") {
        this.maybeFocusedElement = node;
        this.maybeFocusedElementChanged = true;
      }
    } else {
      node.removeAttribute(attr);
    }
  } else if (DOMREC_TEXT in action) {
    let a = action[DOMREC_TEXT];
    this.node(a[0]).data = a[1];
  } else if (DOMREC_ADD in action) {
    let a = action[DOMREC_ADD];
    this.node(a[0]).insertBefore(this.deserialize(a[2]), this.node(a[1]));
    for (let action of a[3]) {
      this.doAction(action);
    }
  } else if (DOMREC_REMOVE in action) {
    let n = action[DOMREC_REMOVE];
    let node = this.node(n);
    // XXX delete descendant nodes from our map too?
    delete this.nodes[n];
    node.remove();
  } else if (DOMREC_INPUT in action) {
    let a = action[DOMREC_INPUT];
    let n = this.node(a[0]);
    let v = a[1];
    if (v) {
      n.value = v;
    }
    this.maybeFocusedElementChanged = true;
  } else if (DOMREC_MOUSE_DOWN in action) {
    let a = action[DOMREC_MOUSE_DOWN];
    this.setCursorPos(a[0], a[1]);
    this.cursor.classList.add("down");
  } else if (DOMREC_MOUSE_UP in action) {
    let a = action[DOMREC_MOUSE_UP];
    this.setCursorPos(a[0], a[1]);
    this.cursor.classList.remove("down");
  } else if (DOMREC_FORCE_STYLE_FLUSH in action) {
    let n = action[DOMREC_FORCE_STYLE_FLUSH];
    this.node(n).getBoundingClientRect();
  } else if (DOMREC_SCROLL in action) {
    let a = action[DOMREC_SCROLL];
    let container = this.node(a[0]);
    if (container.getClientRects().length > 0) {
      let s = a[1];
      if (s == "bottom") {
        container.scrollTop = 1000000;
      } else {
        let element = this.node(s);
        let o = element;
        let offsetY = 0;
        do {
          offsetY += o.offsetTop;
          o = o.offsetParent;
        } while (o != container);
        let offsetHeight = element.offsetHeight;
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
    let a = action[DOMREC_FRAME];
    let frame = this.node(a[0]);
    frame.DOMRecBody = this.deserialize(a[1]);
    if (frame.contentDocument.readyState == "complete") {
      this.setupFrame(frame);
    } else {
      frame.addEventListener("load", (function(event) {
        // Firefox might have destroyed our document due to loading "about:blank".
        // Restore it.
        this.setupFrame(frame);
      }).bind(this));
    }
  } else if (DOMREC_CANVAS_DATA in action) {
    let a = action[DOMREC_CANVAS_DATA];
    let n = this.node(a[0]);
    var img = new window.Image();
    n.loadingImage = img;
    function onload(event) {
      // Check that the right image is drawing. If images decode out of
      // order we could have a problem.
      if (n.loadingImage == event.target) {
        n.getContext("2d").drawImage(img, 0, 0);
        n.loadingImage = null;
      }
      img.removeEventListener("load", onload);
    }
    img.addEventListener("load", onload);
    img.setAttribute("src", a[1]);
  } else {
    throw "Unknown action";
  }
}

DOMReplay.prototype.setCaret = function(element) {
  // Create a fake caret for the text. We need to measure its position using hacks.
  // Currently we assume 'element' is a display:inline <input> or <textarea>.
  if (!(element.tagName == "INPUT" || element.tagName == "TEXTAREA" ||
        element.hasAttribute("contenteditable"))) {
    return;
  }

  let e = document.createElement("DIV");
  e.classList.add("fakeInput");
  e.style.left = element.offsetLeft + "px";
  e.style.top = element.offsetTop + "px";
  e.style.width = element.offsetWidth + "px";
  function pixels(v) {
    if (v.endsWith("px")) {
      return parseInt(v.substring(0, v.length - 2));
    }
    return 0;
  }
  let cs = window.getComputedStyle(element);
  function fixPadding(direction) {
    e.style["padding" + direction] = pixels(cs["border" + direction + "Width"]) +
      pixels(cs["padding" + direction]) + "px";
  }
  fixPadding("Left");
  fixPadding("Top");
  fixPadding("Right");
  fixPadding("Bottom");
  for (let p of ["fontFamily", "fontSize", "verticalAlign", "wordWrap", "whiteSpace"]) {
    e.style[p] = cs[p];
  }
  if (cs.display == "inline-block" || cs.display == "inline") {
    let baselineMeasurer = document.createElement("DIV");
    baselineMeasurer.classList.add("baselineMeasurer");
    element.parentNode.insertBefore(baselineMeasurer, element);
    let baselineRect = baselineMeasurer.getBoundingClientRect();
    let elementRect = element.getBoundingClientRect();
    baselineMeasurer.remove();
    // Create an empty span to push the text baseline down to where it needs to be
    let span = document.createElement("span");
    span.style.height = (baselineRect.bottom - elementRect.top)/this.scaleY + "px";
    e.appendChild(span);
  }
  let value = "value" in element ? element.value : element.textContent;
  let textIndex = value.length;
  // Work around https://bugs.chromium.org/p/chromium/issues/detail?id=839987.
  // If the value is entirely whitespace then we might need more workarounds but
  // that doesn't happen currently.
  if (value == "") {
    value = "|";
  }
  e.appendChild(document.createTextNode(value));

  let parent = element.offsetParent ? element.offsetParent : element.ownerDocument.documentElement;
  parent.appendChild(e);

  let r = new Range();
  r.setStart(e.lastChild, textIndex);
  r.collapse(true);
  let rangeRect = r.getClientRects()[0];
  let parentRect = parent.getBoundingClientRect();
  let caret = document.createElement("DIV");
  caret.classList.add("fakeCaret");
  caret.style.left = (rangeRect.left - parentRect.left)/this.scaleX + "px";
  caret.style.top = (rangeRect.top - parentRect.top)/this.scaleY + "px";
  caret.style.height = rangeRect.height/this.scaleY + "px";
  caret.inputElement = element;

  e.remove();
  parent.appendChild(caret);
  this.caretElement = caret;
}

DOMReplay.prototype.labelIndex = function(name, def) {
  if (typeof name == "undefined") {
    return def;
  }
  for (let i = 0; i < this.actions.length; ++i) {
    if (this.actions[i][DOMREC_LABEL] == name) {
      return i;
    }
  }
  throw "Unknown label " + name;
}

DOMReplay.prototype.stop = function() {
  if (this.pendingTimeout != null) {
    clearTimeout(this.pendingTimeout);
    this.pendingTimeout = null;
  }
  this.hostElem.classList.remove("playing");
  setTitle(this.hostElem);
}

DOMReplay.prototype.stopped = function() {
  return this.pendingTimeout == null;
}

DOMReplay.prototype.seekInternal = function(index) {
  if (this.index > index) {
    this.reset();
  }
  while (this.index < index) {
    this.step();
  }
}

DOMReplay.prototype.seek = function(name) {
  let index = this.labelIndex(name, 0);
  this.stop();
  this.seekInternal(index);
}

function setTitle(d) {
  if (d.hasAttribute("popOut")) {
    if (d.classList.contains("poppedOut")) {
      d.title = "Click outside to shrink";
    } else {
      d.title = "Click to enlarge";
    }
  } else if (d.classList.contains("DOMRecMovie")) {
    if (d.classList.contains("playing")) {
      d.title = "Click to pause";
    } else {
      d.title = "Click to resume";
    }
  } else {
    d.title = "";
  }
}

DOMReplay.prototype.play = function(options) {
  this.stop();
  let stopAtIndex = this.actions.length;
  if (options && ("end" in options)) {
    stopAtIndex = this.labelIndex(options.end);
  }
  let loop = !!(options && options.loop);
  let loopToIndex = 0;
  let timeScale = 1.0;
  if (options && ("timeScale" in options)) {
    timeScale = options.timeScale;
  }
  let playStart = Date.now();
  let playTime = 0;
  let oneLoopTime = 0;
  if (loop) {
    for (let i = loopToIndex; i < stopAtIndex; ++i) {
      let action = this.actions[i];
      if (DOMREC_DELAY in action) {
        oneLoopTime += action[DOMREC_DELAY];
      }
    }
    if (oneLoopTime <= 0) {
      loop = false;
    }
  }
  let doPlay = (function() {
    this.pendingTimeout = null;
    while (true) {
      if (this.index >= stopAtIndex) {
        if (loop) {
          let delay = Date.now() - playStart;
          while (delay > timeScale*(playTime + oneLoopTime)) {
            // Fake playing some loops without doing the work to catch up to real time
            playTime += oneLoopTime;
          }
          this.hostElem.classList.add("looping");
          setTimeout((function() {
            this.hostElem.classList.remove("looping");
          }).bind(this), 500);
          this.seekInternal(loopToIndex);
        } else {
          break;
        }
      }
      let action = this.step();
      if (DOMREC_DELAY in action) {
        playTime += action[DOMREC_DELAY];
        let delay = Date.now() - playStart;
        if (delay < timeScale*playTime) {
          this.pendingTimeout = setTimeout(doPlay, timeScale*playTime - delay);
          break;
        }
      }
    }
  }).bind(this);
  this.hostElem.classList.add("playing");
  setTitle(this.hostElem);
  doPlay();
}

// For subframe external stylesheets, replay loads the stylesheet text and inject the
// text directly into the subframe.
// The key here is the stylesheet URL in the recorded document's LINK
// element, the value is the URL from which we should fetch its text during replay.
const DOMREC_REPLAY_FRAME_STYLESHEETS = {
};
// These stylesheets will be loaded in the main replay frame. We don't try to load
// the original stylesheets from the recording at all; instead list their replay-time
// URLs here.
// XXX this assumes a fixed list of stylesheets will do for all the replays that
// use this script!
const DOMREC_REPLAY_STYLESHEETS = [
    "https://fonts.googleapis.com/css?family=Open+Sans:400,300,700,800,600",
];
// Full URL of the current script
let DOMRecScriptURL = document.currentScript ? document.currentScript.src : null;

// This function gets called to rewrite all the stylesheet URLs during replay.
// This can apply dynamic changes e.g. using DOMRecScriptURL.
function rewriteResourceURL(url) {
}

function DOMSetupReplay(element) {
  let data = window[element.id];
  if (!("initialState" in data)) {
    return false;
  }
  element.textContent = '';
  let frame = document.createElement("iframe");
  let srcdoc = '<html class="replay"><head>';
  for (let sheet of DOMREC_REPLAY_STYLESHEETS) {
    sheet = rewriteResourceURL(sheet);
    srcdoc += '<link rel="stylesheet" href="' + sheet + '">';
  }
  frame.srcdoc = srcdoc;
  // Crazy hack to get the correct size for the IFRAME. We insert an SVG element
  // with the correct aspect ratio and let its intrinsic height be the height of our
  // DIV, then make the IFRAME use that height. Too bad there's no way to tell an IFRAME
  // to use a specific intrinsic ratio.
  let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (window.origin == "http://127.0.0.1:3000" &&
      (element.style.width != data.width + "px" ||
       element.style.height != data.height + "px")) {
    alert("Invalid dimensions for " + element.id + ": expected " +
          data.width + "px x " + data.height + "px, got " +
          element.style.width + " x " + element.style.height);
  }
  svg.setAttribute("viewBox", "0 0 " + data.width + " " + data.height);
  element.appendChild(svg);
  element.appendChild(frame);
  // IFRAME navigation to the srcdoc document will have started but for now
  // we will have a blank document. Make sure this doesn't confuse us.
  frame.contentDocument.initialDoc = true;
  element.frame = frame;

  if (!element.hasAttribute("fixedWidth")) {
    element.style.maxWidth = data.width + "px";
    element.style.width = '';
  }
  element.style.height = '';
  return true;
}
let DOMResolveSetupReplay;
DOMSetupReplayPromise = new Promise(function(resolve, reject) {
  DOMResolveSetupReplay = resolve;
});
function DOMSetupReplayAll() {
  for (let d of document.querySelectorAll(".DOMRecScreenshot")) {
    if (!DOMSetupReplay(d)) {
      return false;
    }
  }
  for (let d of document.querySelectorAll(".DOMRecMovie:not(.demo)")) {
    if (!DOMSetupReplay(d)) {
      return false;
    }
  }
  DOMResolveSetupReplay();
  return true;
}
if (document.readyState == "loading") {
  document.addEventListener("DOMContentLoaded", function() {
    if (!DOMSetupReplayAll()) {
      throw "Data missing";
    }
  });
} else {
  if (!DOMSetupReplayAll()) {
    // The script with the DOMRec data hasn't loaded yet.
    let s = document.currentScript.previousElementSibling;
    if (s.tagName != "SCRIPT") {
      throw "Expected DOMRec data script!";
    }
    s.addEventListener("load", function() {
      if (!DOMSetupReplayAll()) {
        throw "Data missing";
      }
    });
  }
}

function DOMReplayStylesheetCacheLoaded() {
  function onloaded(element, callback) {
    if (!element.frame) {
      return;
    }
    function waitForFonts() {
      element.frame.contentDocument.fonts.ready.then(callback);
    }
    let doc = element.frame.contentDocument;
    if (doc.readyState == "complete" && !doc.initialDoc) {
      waitForFonts();
    } else {
      element.frame.addEventListener("load", waitForFonts);
    }
  }

  function createFullscreenButton(d) {
    if (!document.fullscreenEnabled) {
      return;
    }
    let fullscreen = document.createElement("button");
    fullscreen.className = "fullscreen";
    fullscreen.title = "Click to enter/exit fullscreen";
    fullscreen.addEventListener("click", function(event) {
      event.stopPropagation();
      if (document.fullscreenElement == d) {
        document.exitFullscreen();
      } else {
        function resize() {
          let cw = d.clientWidth;
          let ch = d.clientHeight;
          let data = window[d.id];
          if (data.width*ch < data.height*cw) {
            d.frame.style.top = "0";
            d.frame.style.height = "100%";
            let w = data.width*(ch/data.height);
            d.frame.style.width = w + "px";
            d.frame.style.left = "calc(50% - " + w/2 + "px)";
          } else {
            d.frame.style.left = "0";
            d.frame.style.width = "100%";
            let h = data.height*(cw/data.width);
            d.frame.style.height = h + "px";
            d.frame.style.top = "calc(50% - " + h/2 + "px)";
          }
        }
        let addedResizeListener = false;
        d.requestFullscreen().then(function() {
          resize();
          if (!addedResizeListener) {
            addedResizeListener = true;
            window.addEventListener("resize", resize);
          }
        });
      }
    });
    d.appendChild(fullscreen);
  }

  function tryPopOut(d, event) {
    if (!d.hasAttribute("popOut") || d.classList.contains("poppedOut") ||
        document.fullscreenElement == d) {
      return false;
    }
    event.stopPropagation();

    let container = d.parentNode;
    let dRect = d.getBoundingClientRect();
    container.scrollIntoView({behavior: 'smooth', block: 'start'});

    if (window.getComputedStyle(d).position == 'absolute') {
      let savedMinHeight = container.style.minHeight;
      container.style.minHeight = "0";
      let containerRect = container.getBoundingClientRect();
      let newDWidth = 220 + containerRect.width;
      let newDHeight = newDWidth*dRect.height/dRect.width;
      container.style.height = containerRect.height + "px";
      container.getBoundingClientRect();
      d.classList.add("poppedOut");
      container.style.height = (containerRect.height + newDHeight + 20) + "px";
      d.style.width = newDWidth + "px";
      d.style.top = (containerRect.height + 10) + "px";
      d.escapeHandler = function(event) {
        if (!d.contains(event.target)) {
          document.removeEventListener("click", d.escapeHandler, true);
          d.classList.remove("poppedOut");
          container.style.height = '';
          container.style.minHeight = savedMinHeight;
          d.style.width = '';
          d.style.top = '';
          setTitle(d);
          // Don't stop propagation; allow the click to function normally
        }
      };
    } else {
      let containerRect = container.getBoundingClientRect();
      let newDWidth = containerRect.width;
      d.classList.add("poppedOut");
      d.style.left = "0";
      d.style.width = newDWidth + "px";
      d.escapeHandler = function(event) {
        if (!d.contains(event.target)) {
          document.removeEventListener("click", d.escapeHandler, true);
          d.classList.remove("poppedOut");
          d.style.left = '';
          d.style.width = '';
          setTitle(d);
          // Don't stop propagation; allow the click to function normally
        }
      };
    }

    document.addEventListener("click", d.escapeHandler, true);
    setTitle(d);
    return true;
  }

  function setupScreenshotReplay(d) {
    d.player = new DOMReplay(d);
    createFullscreenButton(d);
    d.addEventListener("click", function(event) {
      if (tryPopOut(d, event)) {
        return;
      }
      if (document.fullscreenElement == d) {
        document.exitFullscreen();
        event.stopPropagation();
      }
    });
    setTitle(d);
  }

  for (let d of document.querySelectorAll(".DOMRecScreenshot")) {
    onloaded(d, function() {
      setupScreenshotReplay(d);
    });
  }

  function setupMovieReplay(d) {
    d.player = new DOMReplay(d);
    let replayIndicator = document.createElement("div");
    d.appendChild(replayIndicator);
    let play = document.createElement("button");
    play.className = "play";
    d.appendChild(play);
    createFullscreenButton(d);
    d.addEventListener("click", function(event) {
      if (tryPopOut(d, event)) {
        return;
      }
      event.stopPropagation();
      if (d.player.stopped()) {
        d.player.play({loop:true});
      } else {
        d.player.stop();
      }
    });
    setTitle(d);
  }

  for (let d of document.querySelectorAll(".DOMRecMovie:not(.demo)")) {
    onloaded(d, function() {
      setupMovieReplay(d);
    });
  }

  window.addEventListener("click", function(event) {
    if (event.target.classList.contains("DOMRecShowDemo")) {
      let demo = event.target.nextSibling;
      demo.classList.toggle("show");
      if (demo.player) {
        if (demo.classList.contains("show")) {
          demo.player.play({loop:true});
        } else {
          demo.player.stop();
        }
      } else {
        DOMSetupReplay(demo);
        onloaded(demo, function() {
          setupMovieReplay(demo);
          demo.player.play({loop:true});
        });
      }

      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function DOMReplayLoadStylesheets() {
  if (!DOMRecScriptURL) {
    // We were injected, not loaded, so just bail out.
    return;
  }
  // The ?1 suffix distinguishes this resource from non-CORS direct loads, to
  // ensure the results are cached separately. Cloudfront/S3 doesn't set CORS
  // headers on non-CORS loads.
  let promises = [DOMSetupReplayPromise];
  for (let s in DOMREC_REPLAY_FRAME_STYLESHEETS) {
    let cached = s;
    let url = rewriteResourceURL(DOMREC_REPLAY_FRAME_STYLESHEETS[s]);
    promises.push(window.fetch(url).then(function(response) {
      if (!response.ok) {
        throw "Failed to load " + url + ": " + response.statusText;
      }
      return response.text();
    }).then(function(text) {
      if (typeof text != "string") {
        throw "Unexpected source text: " + text;
      }
      DOMRecStylesheetCache[cached] = text;
    }));
  }
  Promise.all(promises).then(DOMReplayStylesheetCacheLoaded);
}
DOMReplayLoadStylesheets();

window.addEventListener("load", function() {
  document.body.classList.add("loaded");
});
