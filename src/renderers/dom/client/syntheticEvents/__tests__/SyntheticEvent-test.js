/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails react-core
 */

'use strict';

var SyntheticEvent;
var React;
var ReactDOM;
var ReactTestUtils;

describe('SyntheticEvent', function() {
  var createEvent;

  beforeEach(function() {
    SyntheticEvent = require('SyntheticEvent');
    React = require('React');
    ReactDOM = require('ReactDOM');
    ReactTestUtils = require('ReactTestUtils');

    createEvent = function(nativeEvent) {
      var target = require('getEventTarget')(nativeEvent);
      return SyntheticEvent.getPooled({}, '', nativeEvent, target);
    };
  });

  it('should normalize `target` from the nativeEvent', function() {
    var target = document.createElement('div');
    var syntheticEvent = createEvent({srcElement: target});

    expect(syntheticEvent.target).toBe(target);
    expect(syntheticEvent.type).toBe(undefined);
  });

  it('should be able to `preventDefault`', function() {
    var nativeEvent = {};
    var syntheticEvent = createEvent(nativeEvent);

    expect(syntheticEvent.isDefaultPrevented()).toBe(false);
    syntheticEvent.preventDefault();
    expect(syntheticEvent.isDefaultPrevented()).toBe(true);

    expect(syntheticEvent.defaultPrevented).toBe(true);

    expect(nativeEvent.returnValue).toBe(false);
  });

  it('should be prevented if nativeEvent is prevented', function() {
    expect(
      createEvent({defaultPrevented: true}).isDefaultPrevented()
    ).toBe(true);
    expect(createEvent({returnValue: false}).isDefaultPrevented()).toBe(true);
  });

  it('should be able to `stopPropagation`', function() {
    var nativeEvent = {};
    var syntheticEvent = createEvent(nativeEvent);

    expect(syntheticEvent.isPropagationStopped()).toBe(false);
    syntheticEvent.stopPropagation();
    expect(syntheticEvent.isPropagationStopped()).toBe(true);

    expect(nativeEvent.cancelBubble).toBe(true);
  });

  it('should be able to `persist`', function() {
    var syntheticEvent = createEvent({});

    expect(syntheticEvent.isPersistent()).toBe(false);
    syntheticEvent.persist();
    expect(syntheticEvent.isPersistent()).toBe(true);
  });

  it('should be nullified if the synthetic event has called destructor and log warnings', function() {
    spyOn(console, 'error');
    var target = document.createElement('div');
    var syntheticEvent = createEvent({srcElement: target});
    syntheticEvent.destructor();
    expect(syntheticEvent.type).toBe(null);
    expect(syntheticEvent.nativeEvent).toBe(null);
    expect(syntheticEvent.target).toBe(null);
    expect(console.error.calls.length).toBe(3); // once for each property accessed
    expect(console.error.argsForCall[0][0]).toBe( // assert the first warning for accessing `type`
      'Warning: This synthetic event is reused for performance reasons. If you\'re seeing this,' +
      'you\'re accessing the property `type` on a released/nullified synthetic event. This is set to null.' +
      'If you must keep the original synthetic event around, use event.persist().' +
      'See https://fb.me/react-event-pooling for more information.'
    );
  });

  it('should warn when setting properties of a destructored synthetic event', function() {
    spyOn(console, 'error');
    var target = document.createElement('div');
    var syntheticEvent = createEvent({srcElement: target});
    syntheticEvent.destructor();
    expect(syntheticEvent.type = 'MouseEvent').toBe('MouseEvent');
    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toBe(
      'Warning: This synthetic event is reused for performance reasons. If you\'re seeing this,' +
      'you\'re setting the property `type` on a released/nullified synthetic event. This is effectively a no-op.' +
      'If you must keep the original synthetic event around, use event.persist().' +
      'See https://fb.me/react-event-pooling for more information.'
    );
  });

  it('should warn if the synthetic event has been released when calling `preventDefault`', function() {
    spyOn(console, 'error');
    var syntheticEvent = createEvent({});
    SyntheticEvent.release(syntheticEvent);
    syntheticEvent.preventDefault();
    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toBe(
      'Warning: This synthetic event is reused for performance reasons. If you\'re seeing this,' +
      'you\'re accessing the method `preventDefault` on a released/nullified synthetic event. This is a no-op function.' +
      'If you must keep the original synthetic event around, use event.persist().' +
      'See https://fb.me/react-event-pooling for more information.'
    );
  });

  it('should warn if the synthetic event has been released when calling `stopPropagation`', function() {
    spyOn(console, 'error');
    var syntheticEvent = createEvent({});
    SyntheticEvent.release(syntheticEvent);
    syntheticEvent.stopPropagation();
    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toBe(
      'Warning: This synthetic event is reused for performance reasons. If you\'re seeing this,' +
      'you\'re accessing the method `stopPropagation` on a released/nullified synthetic event. This is a no-op function.' +
      'If you must keep the original synthetic event around, use event.persist().' +
      'See https://fb.me/react-event-pooling for more information.'
    );
  });

  it('should properly log warnings when events simulated with rendered components', function() {
    spyOn(console, 'error');
    var event;
    var element = document.createElement('div');
    function assignEvent(e) {
      event = e;
    }
    var instance = ReactDOM.render(<div onClick={assignEvent} />, element);
    ReactTestUtils.Simulate.click(ReactDOM.findDOMNode(instance));
    expect(console.error.calls.length).toBe(0);

    // access a property to cause the warning
    event.nativeEvent; // eslint-disable-line no-unused-expressions

    expect(console.error.calls.length).toBe(1);
    expect(console.error.argsForCall[0][0]).toBe(
      'Warning: This synthetic event is reused for performance reasons. If you\'re seeing this,' +
      'you\'re accessing the property `nativeEvent` on a released/nullified synthetic event. This is set to null.' +
      'If you must keep the original synthetic event around, use event.persist().' +
      'See https://fb.me/react-event-pooling for more information.'
    );
  });
});
