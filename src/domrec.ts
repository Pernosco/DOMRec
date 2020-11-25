/* Copyright Pernosco 2020. See LICENSE. */

import { DOMReplay } from './DOMReplay';

const DOMRecStylesheetCache = {};
const DOMREC_SKIP_HIDDEN_IDS = ['toolbox'];
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

(window as any).DOMREC_SKIP_HIDDEN_IDS = DOMREC_SKIP_HIDDEN_IDS;
(window as any).DOMRecStylesheetCache = DOMRecStylesheetCache;
(window as any).DOMREC_REPLAY_FRAME_STYLESHEETS = DOMREC_REPLAY_FRAME_STYLESHEETS;
(window as any).DOMREC_REPLAY_STYLESHEETS = DOMREC_REPLAY_STYLESHEETS;
(window as any).DOMREC_REPLAY_STYLESHEETS = DOMREC_REPLAY_STYLESHEETS;
(window as any).DOMRecScriptURL = DOMRecScriptURL;

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
