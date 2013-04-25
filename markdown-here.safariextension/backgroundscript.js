/*
 * Copyright Adam Pritchard 2013
 * MIT License : http://adampritchard.mit-license.org/
 */

"use strict";
/*global safari:false, OptionsStore:false, markdownRender:false,
  htmlToText:false, marked:false, hljs:false*/
/*jshint devel:true*/


/*
 * Event handlers
 */

function activateHandler(event) {
  if (!event.target.page) {
    return;
  }

  // Tell the page that it's been activated.
  event.target.page.dispatchMessage('tab-activated');
}
safari.application.addEventListener('activate', activateHandler, true);


function deactivateHandler(event) {
  if (!event.target.page) {
    return;
  }

  // Tell the page that it's been deactivated.
  event.target.page.dispatchMessage('tab-deactivated');
}
safari.application.addEventListener('deactivate', deactivateHandler, true);


// 'validate' is received when the window wants the button state updated.
// We don't really use this, except to disable the button when there's no page.
function validateCommand(event) {
  // Disable the button if there is no URL loaded in the tab.
  if (event.target.browserWindow &&
      event.target.browserWindow.activeTab &&
      !event.target.browserWindow.activeTab.url) {
    event.target.disabled = true;
  }
}
safari.application.addEventListener('validate', validateCommand, false);


// This is the event handler for the button and the context menu.
function toggleHandler(event) {
  // The context menu event doesn't have a browser window target.
  var browserWindow = event.target.browserWindow || safari.application.activeBrowserWindow;

  // Tell the content script to do the rendering-toggling.
  browserWindow.activeTab.page.dispatchMessage('mdh-toggle');
}
safari.application.addEventListener('command', toggleHandler, false);


/*
 * Show changelist
 */
/*
// On each load, check if we should show the options/changelist page.
window.addEventListener('load', function() {
    OptionsStore.get(function(options) {
      var appDetails = chrome.app.getDetails();

      // Have we been updated?
      if (options['last-version'] !== appDetails.version) {
        // Open our options page in changelist mode
        chrome.tabs.create({ url: appDetails.options_page + "#changelist" });

        // Update out last version
        OptionsStore.set({ 'last-version': appDetails.version });
      }
    });
  }, false);
*/


/*
 * Handle messages from the content script.
 */
function contentMessageHandler(event) {
  // Render some Markdown.
  if (event.name === 'render') {
    OptionsStore.get(function(prefs) {
      event.target.page.dispatchMessage(
        'render-response',
        {
          html: markdownRender(
            prefs,
            htmlToText,
            marked,
            hljs,
            event.message.html,
            document,
            event.target.url),
          css: (prefs['main-css'] + prefs['syntax-css']),
          requestID: event.message.requestID
        }
      );
    });
    return;
  }

  // Get the options object.
  else if (event.name === 'get-options') {
    OptionsStore.get(function(options) {
      event.target.page.dispatchMessage(
        'get-options-response',
        { options: options, requestID: event.message.requestID });
    });
    return;
  }

  // Set options values.
  else if (event.name === 'set-options') {
    OptionsStore.set(event.message.options, function() {
      event.target.page.dispatchMessage(
        'set-options-response',
        { requestID: event.message.requestID });
    });
    return;
  }

  // Enable/disable the toggle button.
  else if (event.name === 'show-toggle-button') {
    // Only the active tab gets to set the button state -- ignore messages from
    // all other tabs.
    if (event.target === event.target.browserWindow.activeTab) {
      safari.extension.toolbarItems[0].disabled = !event.message.show;
    }
    return;
  }
  else {
    console.log('unmatched request action', event);
    throw 'unmatched request action: ' + event.name;
  }
}
safari.application.addEventListener('message', contentMessageHandler, false);
