// This file exists both to give a single entry point for all the utility
// modules in src/test and to specify an ordering on those modules, since
// some still have implicit dependencies on others.

var Ap = Array.prototype;
var slice = Ap.slice;
var Fp = Function.prototype;

if (!Fp.bind) {
  // PhantomJS doesn't support Function.prototype.bind natively, so
  // polyfill it whenever this module is required.
  Fp.bind = function(context) {
    var func = this;
    var args = slice.call(arguments, 1);

    function bound() {
      var invokedAsConstructor = func.prototype && (this instanceof func);
      return func.apply(
        // Ignore the context parameter when invoking the bound function
        // as a constructor. Note that this includes not only constructor
        // invocations using the new keyword but also calls to base class
        // constructors such as BaseClass.call(this, ...) or super(...).
        !invokedAsConstructor && context || this,
        args.concat(slice.call(arguments))
      );
    }

    // The bound function must share the .prototype of the unbound
    // function so that any object created by one constructor will count
    // as an instance of both constructors.
    bound.prototype = func.prototype;

    return bound;
  };
}

require("ReactTestUtils");
require("reactComponentExpect");
require("mocks");
require("mock-modules");
require("./mock-timers");

exports.enableTest = function(testID) {
  require("../" + testID);
};

exports.removeSiblings = function(node) {
  var parent = node && node.parentNode;
  if (parent) {
    while (node.nextSibling) {
      parent.removeChild(node.nextSibling);
    }
  }
};
