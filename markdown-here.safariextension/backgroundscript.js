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
        // Open our options page in changelist mode
        var newTab = safari.application.activeBrowserWindow.openTab();
        newTab.url = safari.extension.baseURI + 'markdown-here/src/common/options.html#changelist';

        // Update out last version
        safari.extension.secureSettings['last-version'] = currentVersion;
      }
    });
  }, false);


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

  // Remove options values.
  else if (event.name === 'remove-options') {
    OptionsStore.remove(event.message.arrayOfKeys, function() {
      event.target.page.dispatchMessage(
        'remove-options-response',
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
