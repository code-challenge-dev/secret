import { createElement } from 'react';
import { createRoot, flushSync } from 'react-dom';
import DevTools from 'src/devtools/views/DevTools';
import { getBrowserName, getBrowserTheme } from '../utils';

export function createPanel(defaultTab) {
  let injectedBridge = null;
  let injectedStore = null;
  let root = null;

  // All DevTools panel share a single Bridge and Store instance.
  // The main script will inject those shared instances using this method.
  window.injectBridgeAndStore = (bridge, store) => {
    injectedBridge = bridge;
    injectedStore = store;

    if (root === null) {
      injectAndInit();
    } else {
      // It's easiest to recreate the DevTools panel (to clean up potential stale state).
      // We can revisit this in the future as a small optimization.
      flushSync(() => root.unmount(injectAndInit));
    }
  };

  function injectAndInit() {
    const container = ((document.getElementById(
      'container'
    ): any): HTMLElement);

    // Clear the "React not found" initial message before rendering.
    container.innerHTML = '';

    root = createRoot(container);
    root.render(
      createElement(DevTools, {
        bridge: injectedBridge,
        browserName: getBrowserName(),
        browserTheme: getBrowserTheme(),
        defaultTab,
        showTabBar: false,
        store: injectedStore,
      })
    );
  }
}
