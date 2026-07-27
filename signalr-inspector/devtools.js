'use strict';

chrome.devtools.panels.create(
  'SignalR Inspector',
  'icons/icon32.png',
  'panel.html',
  () => undefined,
);
