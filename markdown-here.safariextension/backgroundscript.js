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
 * Respond to the user asking to see the options page.
 */
/*
Handler for the event we get when the `secureSettings` change. The only one we
act on is the stub "show options" checkbox, which we use to indicate that we
should... show the options page.
The reason we use `secureSettings` rather than `settings` is to keep this
fake option separate from our real options. (Which might not seem terribly
coherent, and isn't.)
*/
function settingsChangeHandler(event) {
  if (event.key == 'markdown_here_show_options') {
    var newTab = safari.application.activeBrowserWindow.openTab();
    newTab.url = safari.extension.baseURI + 'markdown-here/src/common/options.html';
  }
}
safari.extension.secureSettings.addEventListener('change', settingsChangeHandler, false);


/*
 * Show changelist
 */
// On each load, check if we should show the options/changelist page.
window.addEventListener('load', function() {
    OptionsStore.get(function(options) {
      var currentVersion = safari.extension.bundleVersion;

      // Have we been updated?
      if (safari.extension.secureSettings['last-version'] !== currentVersion) {

        // Open our options page

        var optionsUrl = safari.extension.baseURI + 'markdown-here/src/common/options.html';

        // If this is an upgrade, open the options page in changelist mode
        if (safari.extension.secureSettings['last-version']) {
          optionsUrl += '?prevVer=' + safari.extension.secureSettings['last-version'];
        }

        // Open our options page in changelist mode
        var newTab = safari.application.activeBrowserWindow.openTab();
        newTab.url = optionsUrl;

        // Update out last version
        safari.extension.secureSettings['last-version'] = currentVersion;
      }
    });
  }, false);


/*
 * Handle messages from the content script.
 */
function contentMessageHandler(event) {
  if (!event.target.page) {
    // This sometimes get hit by content scripts loaded into not-real-pages,
    // like the new tab "Top Sites/History" thing.
    return;
  }

  if (event.name !== 'request') {
    console.log('unmatched request name', event);
    throw 'unmatched request name: ' + event.name;
  }

  var request = event.message;

  var responseCallback = function(response) {
    event.target.page.dispatchMessage(
      'request-response',
      {
        requestID: request.requestID,
        response: response
      });
  };

  if (request.action === 'test-request') {
    responseCallback('test-request-good');
    return;
  }
  else if (request.action === 'render') {
    OptionsStore.get(function(prefs) {
      responseCallback({
        html: MarkdownRender.markdownRender(
          request.mdText,
          prefs,
          marked,
          hljs),
        css: (prefs['main-css'] + prefs['syntax-css'])
      });
    });
    return;
  }
  else if (request.action === 'get-options') {
    OptionsStore.get(responseCallback);
    return;
  }
  else if (request.action === 'set-options') {
    OptionsStore.set(request.options, responseCallback);
    return;
  }
  else if (request.action === 'remove-options') {
    OptionsStore.remove(request.arrayOfKeys, responseCallback);
    return;
  }
  else if (request.action === 'show-toggle-button') {
    // Enable/disable the toggle button.
    // Only the active tab gets to set the button state -- ignore messages from
    // all other tabs.
    if (event.target === event.target.browserWindow.activeTab) {
      safari.extension.toolbarItems[0].disabled = !request.show;
    }
    responseCallback();
    return;
  }
  else if (request.action === 'get-forgot-to-render-prompt') {
    CommonLogic.getForgotToRenderPromptContent(function(html) {
      responseCallback({ html: html });
    });
    return;
  }
  else {
    console.log('unmatched request action', event);
    throw 'unmatched request action: ' + request.action;
  }
}
safari.application.addEventListener('message', contentMessageHandler, false);
