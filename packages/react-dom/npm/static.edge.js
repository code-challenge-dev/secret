'use strict';

var s;
if (process.env.NODE_ENV === 'production') {
  s = require('./cjs/react-dom-server.edge.production.min.js');
} else {
  s = require('./cjs/react-dom-server.edge.development.js');
}

exports.version = s.version;
exports.prerender = s.prerender;
