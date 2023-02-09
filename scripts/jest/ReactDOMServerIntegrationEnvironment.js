'use strict';

const {TestEnvironment: JSDOMEnvironment} = require('jest-environment-jsdom');
const {TestEnvironment: NodeEnvironment} = require('jest-environment-node');

/**
 * Test environment for testing integration of react-dom (browser) with react-dom/server (node)
 */
class ReactDOMServerIntegrationEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);

    this.domEnvironment = new JSDOMEnvironment(config, context);

    this.global.window = this.domEnvironment.dom.window;
    this.global.document = this.global.window.document;
    this.global.navigator = this.global.window.navigator;
    this.global.Node = this.global.window.Node;
  }

  async setup() {
    await super.setup();
    await this.domEnvironment.setup();
  }

  async teardown() {
    await this.domEnvironment.teardown();
    await super.teardown();
  }
}

module.exports = ReactDOMServerIntegrationEnvironment;
