/*
 * Copyright Adam Pritchard 2013
 * MIT License : http://adampritchard.mit-license.org/
 */

"use strict";
/*global safari:false, markdownHere:false, MdhHtmlToText:false*/
/*jshint devel:true, browser:true*/


/*
Safari injects content scripts into all src'd subelements -- like iframes.
This could be helpful later on (we've had to write around the fact that
Chrome and Firefox don't behave like that), but for now our code is written
for one contentscript per page. So we're only going to take action here if
we're the top-level script.
*/
var g_permaDisabled = (window.top !== window && !window.LOAD_MARKDOWN_HERE_CONTENT_SCRIPT);


// Handle messages received from the background script.
function backgroundMessageHandler(event) {
  var focusedElem, mdReturn;

  if (event.name === 'mdh-toggle') {
    // Do the Markdown render toggle.
    if (g_permaDisabled) {
      return;
    }

    // Check if the focused element is a valid render target
    focusedElem = markdownHere.findFocusedElem(window.document);
    if (!focusedElem) {
      // Shouldn't happen. But if it does, just silently abort.
      return;
    }

    if (!markdownHere.elementCanBeRendered(focusedElem)) {
      alert('The selected field is not valid for Markdown rendering. Please use a rich editor.');
      return;
    }

    var logger = function() { console.log.apply(console, arguments); };

    mdReturn = markdownHere(document, requestMarkdownConversion, logger);

    if (typeof(mdReturn) === 'string') {
      // Error message was returned.
      alert(mdReturn);
      return;
    }

    return;
  }
  else if (event.name === 'tab-activated') {
    // Background script is letting us know that this tab has been activated.
    // Reset the button enabled state. (Now that this tab is in charge.)
    g_lastElemChecked = undefined;
    g_lastRenderable = undefined;
    // And immediate update the button state.
    setToggleButtonVisibility(document.activeElement);
    return;
  }
  else if (event.name === 'tab-deactivated') {
    // Background script is letting us know that this tab has been deactivated.
    return;
  }
}
safari.self.addEventListener('message', backgroundMessageHandler, false);


// The rendering service provided to the content script.
function requestMarkdownConversion(elem, range, callback) {
  var mdhHtmlToText = new MdhHtmlToText.MdhHtmlToText(elem, range);

  // Send a request to the add-on script to actually do the rendering.
  Utils.makeRequestToPrivilegedScript(
    document,
    { action: 'render', mdText: mdhHtmlToText.get() },
    function(response) {
      var renderedMarkdown = mdhHtmlToText.postprocess(response.html);
      callback(renderedMarkdown, response.css);
    });
}


/*
 * Enable/disable the toggle button.
 */

// We're going to show the button depending on whether the currently focused
// element is renderable or not. We'll keep track of what's "currently
// focused" in two ways:
//   1) Handling `focus` events. But that doesn't work for iframes, so we also
//      need...
//   2) An interval timer. Every so often we'll check the current focus.
//
// In principle, the #2 is sufficient by itself, but it's nice to have the
// immediate response of #1 where possible. (And I hesitate to make the timer
// interval too small. I already find this approach distasteful.) The focus
// event does actually work for the new Chrome+Gmail interface, which is an
// important target.
//
// The problem with iframes is that they don't get focus/blur events when
// moving between iframes.
//
// Regarding the `focus` event: Chrome seems to give us (bubbling) focus
// events if `useCapture` is true. Firefox doesn't seem to give us focus
// events at all (and it doesn't provide `focusin` or `DOMFocusIn`). So on FF
// we're basically relaying entirely on the interval checks.

function showToggleButton(show) {
  Utils.makeRequestToPrivilegedScript(
    document,
    { action: 'show-toggle-button', show: show });
}


var g_lastElemChecked, g_lastRenderable;
function setToggleButtonVisibility(elem) {
  var renderable = false;

  if (g_permaDisabled) {
    return;
  }

  // Assumption: An element does not change renderability.
  if (elem === g_lastElemChecked) {
    return;
  }
  g_lastElemChecked = elem;

  if (elem && elem.ownerDocument) {
    // We may have gotten here via the timer, so we'll add an event handler.
    // Setting the event handler like this lets us better deal with iframes.
    // It's okay to call `addEventListener` more than once with the exact same
    // arguments.
    elem.ownerDocument.addEventListener('focus', focusChange, true);

    renderable = markdownHere.elementCanBeRendered(elem);
  }

  if (renderable !== g_lastRenderable) {
    showToggleButton(renderable);
    g_lastRenderable = renderable;
  }
}


// When the focus in the page changes, check if the newly focused element is
// a valid Markdown Toggle target.
function focusChange(event) {
  setToggleButtonVisibility(event.target);
}
if (!g_permaDisabled) {
  window.document.addEventListener('focus', focusChange, true);
}


function buttonIntervalCheck(focusedElem) {
  setToggleButtonVisibility(focusedElem);
}


/*
 * Hotkey support
 */

// Default the hotkey check to a no-op until we get the necessary info from the
// user options.
var hotkeyIntervalCheck = function(focusedElem) {};

function hotkeySetup(prefs) {
  // Only add a listener if a key is set
  if (prefs.hotkey.key.length === 1) {

    // HACK: In Chrome, we have to add a keydown listener to every iframe of interest,
    // otherwise the handler will only fire on the topmost window. It's difficult
    // to iterate (recursively) through iframes and add listeners to them (especially
    // for Yahoo, where there isn't a page change when the compose window appears,
    // so this content script doesn't get re-run). Instead we're going to use the
    // dirty hack of checking every few seconds if the user has focused a new iframe
    // and adding a handler to it.
    // Note that this will result in addEventListener being called on the same
    // iframe/document repeatedly, but that's okay -- duplicate handlers are discarded.
    // https://developer.mozilla.org/en-US/docs/DOM/element.addEventListener#Multiple_identical_event_listeners

    // The actual hotkey event handler.
    var hotkeyHandler = function(event) {
      if (event.shiftKey === prefs.hotkey.shiftKey &&
          event.ctrlKey === prefs.hotkey.ctrlKey &&
          event.altKey === prefs.hotkey.altKey &&
          event.which === prefs.hotkey.key.toUpperCase().charCodeAt(0)) {
        backgroundMessageHandler({ name: 'mdh-toggle' });
        event.preventDefault();
        return false;
      }
    };

    // The hotkey option is enabled, and we've created our event handler function,
    // so now let's do real hotkey interval checking.
    hotkeyIntervalCheck = function(focusedElem) {
      if (focusedElem.ownerDocument) {
        focusedElem = focusedElem.ownerDocument;
      }

      // TODO: Chrome and Mozilla: Only add a hotkey handler on pages/iframes that
      // are valid targets. And/or let the hotkey match if the correct type of
      // control has focus.

      focusedElem.addEventListener('keydown', hotkeyHandler, false);
    };
  }
  // else the hotkey is disabled and we'll leave hotkeyIntervalCheck as a no-op
}
if (!g_permaDisabled) {
  Utils.makeRequestToPrivilegedScript(
    document,
    { action: 'get-options' },
    hotkeySetup);
}


/*
 * Interval checks
 * See specific sections above for reasons why this is necessary.
 */

var forgotToRenderIntervalCheckPrefs = null;

function intervalCheck() {
  var focusedElem = markdownHere.findFocusedElem(window.document);
  if (!focusedElem) {
    return;
  }

  hotkeyIntervalCheck(focusedElem);
  buttonIntervalCheck(focusedElem);

  if (forgotToRenderIntervalCheckPrefs === null) {
    Utils.makeRequestToPrivilegedScript(
      document,
      { action: 'get-options' },
      function(prefs) {
        forgotToRenderIntervalCheckPrefs = prefs;
      });
  }
  else {
    CommonLogic.forgotToRenderIntervalCheck(
      focusedElem,
      markdownHere,
      MdhHtmlToText,
      marked,
      forgotToRenderIntervalCheckPrefs);
  }
}
if (!g_permaDisabled) {
  setInterval(intervalCheck, 2000);
}
