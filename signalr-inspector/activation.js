'use strict';

(function exposeActivation(root, factory) {
  const activation = factory();
  root.SignalRInspectorActivation = activation;
  if (typeof module === 'object' && module.exports) {
    module.exports = activation;
  }
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function scriptIdsForTab(tabId) {
    return [`signalr-bridge-${tabId}`, `signalr-main-${tabId}`];
  }

  function matchPatternForUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return null;
    }

    return `${url.protocol}//${url.hostname}/*`;
  }

  function registrationsForTab(tabId, matchPattern) {
    const [bridgeId, mainId] = scriptIdsForTab(tabId);
    const shared = {
      matches: [matchPattern],
      persistAcrossSessions: false,
      runAt: 'document_start',
    };

    return [
      {
        ...shared,
        id: bridgeId,
        js: ['contentScript.js'],
        world: 'ISOLATED',
      },
      {
        ...shared,
        id: mainId,
        js: ['injected.js'],
        world: 'MAIN',
      },
    ];
  }

  async function activateTab(chromeApi, tab) {
    if (!Number.isInteger(tab?.id) || tab.id < 0) {
      throw new Error('The active browser tab could not be identified.');
    }

    const matchPattern = matchPatternForUrl(tab.url);
    if (!matchPattern) {
      throw new Error('SignalR Inspector can only run on HTTP and HTTPS pages.');
    }

    const scriptIds = scriptIdsForTab(tab.id);
    await chromeApi.scripting.unregisterContentScripts({ ids: scriptIds }).catch(() => undefined);
    await chromeApi.scripting.registerContentScripts(registrationsForTab(tab.id, matchPattern));
    await chromeApi.tabs.reload(tab.id);
    return matchPattern;
  }

  async function isTabActive(chromeApi, tab) {
    if (!Number.isInteger(tab?.id) || tab.id < 0) {
      return false;
    }

    const matchPattern = matchPatternForUrl(tab.url);
    if (!matchPattern) {
      return false;
    }

    const scriptIds = scriptIdsForTab(tab.id);
    const registrations = await chromeApi.scripting.getRegisteredContentScripts({ ids: scriptIds });
    return scriptIds.every((scriptId) =>
      registrations.some(
        (registration) =>
          registration.id === scriptId && registration.matches?.includes(matchPattern),
      ),
    );
  }

  async function deactivateTab(chromeApi, tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return;
    }
    await chromeApi.scripting
      .unregisterContentScripts({ ids: scriptIdsForTab(tabId) })
      .catch(() => undefined);
  }

  async function toggleTab(chromeApi, tab) {
    if (await isTabActive(chromeApi, tab)) {
      await deactivateTab(chromeApi, tab.id);
      await chromeApi.tabs.reload(tab.id);
      return 'inactive';
    }

    await activateTab(chromeApi, tab);
    return 'active';
  }

  return {
    activateTab,
    deactivateTab,
    isTabActive,
    matchPatternForUrl,
    registrationsForTab,
    scriptIdsForTab,
    toggleTab,
  };
});
