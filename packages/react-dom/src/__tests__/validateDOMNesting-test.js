/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

const React = require('react');
const ReactDOM = require('react-dom');
const ReactDOMClient = require('react-dom/client');
const assertConsoleErrorDev =
  require('internal-test-utils').assertConsoleErrorDev;

function expectWarnings(tags, warnings = [], withoutStack = 0) {
  tags = [...tags];
  warnings = [...warnings];

  document.removeChild(document.documentElement);
  document.appendChild(document.createElement('html'));
  document.documentElement.innerHTML = '<head></head><body></body>';

  let element = null;
  const containerTag = tags.shift();
  let container;
  switch (containerTag) {
    case '#document':
      container = document;
      break;
    case 'html':
      container = document.documentElement;
      break;
    case 'body':
      container = document.body;
      break;
    case 'head':
      container = document.head;
      break;
    case 'svg':
      container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      break;
    default:
      container = document.createElement(containerTag);
      break;
  }

  while (tags.length) {
    const Tag = tags.pop();
    if (Tag === '#text') {
      element = 'text';
    } else {
      element = <Tag>{element}</Tag>;
    }
  }

  const root = ReactDOMClient.createRoot(container);
  ReactDOM.flushSync(() => {
    root.render(element);
  });
  if (warnings.length) {
    assertConsoleErrorDev(
      warnings,
      withoutStack > 0 ? {withoutStack} : undefined,
    );
  }
  root.unmount();
}

describe('validateDOMNesting', () => {
  it('allows valid nestings', () => {
    expectWarnings(['table', 'tbody', 'tr', 'td', 'b']);
    expectWarnings(['body', 'datalist', 'option']);
    expectWarnings(['div', 'a', 'object', 'a']);
    expectWarnings(['div', 'p', 'button', 'p']);
    expectWarnings(['p', 'svg', 'foreignObject', 'p']);
    expectWarnings(['html', 'body', 'div']);

    // Invalid, but not changed by browser parsing so we allow them
    expectWarnings(['div', 'ul', 'ul', 'li']);
    expectWarnings(['div', 'label', 'div']);
    expectWarnings(['div', 'ul', 'li', 'section', 'li']);
    expectWarnings(['div', 'ul', 'li', 'dd', 'li']);
  });

  it('prevents problematic nestings', () => {
    expectWarnings(
      ['a', 'a'],
      [
        'In HTML, <a> cannot be a descendant of <a>.\n' +
          'This will cause a hydration error.\n' +
          '    in a (at **)',
      ],
    );
    expectWarnings(
      ['form', 'form'],
      [
        'In HTML, <form> cannot be a descendant of <form>.\n' +
          'This will cause a hydration error.\n' +
          '    in form (at **)',
      ],
    );
    expectWarnings(
      ['p', 'p'],
      [
        'In HTML, <p> cannot be a descendant of <p>.\n' +
          'This will cause a hydration error.\n' +
          '    in p (at **)',
      ],
    );
    expectWarnings(
      ['table', 'tr'],
      [
        'In HTML, <tr> cannot be a child of <table>. ' +
          'Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser.\n' +
          'This will cause a hydration error.\n' +
          '    in tr (at **)',
      ],
    );
    expectWarnings(
      ['div', 'ul', 'li', 'div', 'li'],
      gate(flags => flags.enableOwnerStacks)
        ? [
            'In HTML, <li> cannot be a descendant of <li>.\n' +
              'This will cause a hydration error.\n' +
              '\n' +
              '  <ul>\n' +
              '>   <li>\n' +
              '      <div>\n' +
              '>       <li>\n' +
              '\n' +
              '    in li (at **)',
            '<li> cannot contain a nested <li>.\nSee this log for the ancestor stack trace.\n' +
              '    in li (at **)',
          ]
        : [
            'In HTML, <li> cannot be a descendant of <li>.\n' +
              'This will cause a hydration error.\n' +
              '\n' +
              '  <ul>\n' +
              '>   <li>\n' +
              '      <div>\n' +
              '>       <li>\n' +
              '\n' +
              '    in li (at **)\n' +
              '    in div (at **)\n' +
              '    in li (at **)\n' +
              '    in ul (at **)',
          ],
    );
    expectWarnings(
      ['div', 'html'],
      [
        'In HTML, <html> cannot be a child of <div>.\n' +
          'This will cause a hydration error.\n' +
          '    in html (at **)',
      ],
    );
    expectWarnings(
      ['body', 'body'],
      [
        'In HTML, <body> cannot be a child of <body>.\n' +
          'This will cause a hydration error.\n' +
          '    in body (at **)',
      ],
    );
    expectWarnings(
      ['head', 'body'],
      [
        'In HTML, <body> cannot be a child of <head>.\n' +
          'This will cause a hydration error.\n' +
          '    in body (at **)',
      ],
    );
    expectWarnings(
      ['head', 'head'],
      [
        'In HTML, <head> cannot be a child of <head>.\n' +
          'This will cause a hydration error.\n' +
          '    in head (at **)',
      ],
    );
    expectWarnings(
      ['html', 'html'],
      [
        'In HTML, <html> cannot be a child of <html>.\n' +
          'This will cause a hydration error.\n' +
          '    in html (at **)',
      ],
    );
    expectWarnings(
      ['body', 'html'],
      [
        'In HTML, <html> cannot be a child of <body>.\n' +
          'This will cause a hydration error.\n' +
          '    in html (at **)',
      ],
    );
    expectWarnings(
      ['head', 'html'],
      [
        'In HTML, <html> cannot be a child of <head>.\n' +
          'This will cause a hydration error.\n' +
          '    in html (at **)',
      ],
    );
    expectWarnings(
      ['svg', 'foreignObject', 'body', 'p'],
      gate(flags => flags.enableOwnerStacks)
        ? [
            // TODO, this should say "In SVG",
            'In HTML, <body> cannot be a child of <foreignObject>.\n' +
              'This will cause a hydration error.\n' +
              '\n' +
              '> <foreignObject>\n' +
              '>   <body>\n' +
              '\n' +
              '    in body (at **)',
          ]
        : [
            // TODO, this should say "In SVG",
            'In HTML, <body> cannot be a child of <foreignObject>.\n' +
              'This will cause a hydration error.\n' +
              '\n' +
              '> <foreignObject>\n' +
              '>   <body>\n' +
              '\n' +
              '    in body (at **)\n' +
              '    in foreignObject (at **)',
          ],
    );
  });

  it('relaxes the nesting rules at the root when the container is a singleton', () => {
    expectWarnings(['#document', 'html']);
    expectWarnings(['#document', 'body']);
    expectWarnings(['#document', 'head']);
    expectWarnings(['#document', 'div']);
    expectWarnings(['#document', 'meta']);
    expectWarnings(['#document', '#text']);
    expectWarnings(['html', 'body']);
    expectWarnings(['html', 'head']);
    expectWarnings(['html', 'div']);
    expectWarnings(['html', 'meta']);
    expectWarnings(['html', '#text']);
    expectWarnings(['body', 'head']);
    expectWarnings(['body', 'div']);
    expectWarnings(['body', 'meta']);
    expectWarnings(['body', '#text']);
  });
});
