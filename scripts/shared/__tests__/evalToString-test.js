/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

var evalToString = require('../evalToString');
var babylon = require('babylon');

var parse = source => babylon.parse(`(${source});`).program.body[0].expression; // quick way to get an exp node

var parseAndEval = source => evalToString(parse(source));

describe('evalToString', () => {
  it('should support StringLiteral', () => {
    expect(parseAndEval(`'foobar'`)).toBe('foobar');
    expect(parseAndEval(`'yowassup'`)).toBe('yowassup');
  });

  it('should support string concat (`+`)', () => {
    expect(parseAndEval(`'foo ' + 'bar'`)).toBe('foo bar');
  });

  it('should throw when it finds other types', () => {
    expect(() => parseAndEval(`'foo ' + true`)).toThrowError(
      /Unsupported type/
    );
    expect(() => parseAndEval(`'foo ' + 3`)).toThrowError(/Unsupported type/);
    expect(() => parseAndEval(`'foo ' + null`)).toThrowError(
      /Unsupported type/
    );
    expect(() => parseAndEval(`'foo ' + undefined`)).toThrowError(
      /Unsupported type/
    );
  });
});
