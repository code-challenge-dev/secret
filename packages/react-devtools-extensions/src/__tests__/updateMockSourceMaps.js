const {transformSync} = require('@babel/core');
const {btoa} = require('base64');
const {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require('fs');
const {emptyDirSync} = require('fs-extra');
const {resolve} = require('path');
const rollup = require('rollup');
const babel = require('rollup-plugin-babel');
const commonjs = require('rollup-plugin-commonjs');
const jsx = require('acorn-jsx');
const rollupResolve = require('rollup-plugin-node-resolve');
const {encode, decode} = require('sourcemap-codec');
const {generateEncodedHookMap} = require('../generateHookMap');
const {parse} = require('@babel/parser');

const sourceDir = resolve(__dirname, '__source__');
const buildRoot = resolve(sourceDir, '__compiled__');
const externalDir = resolve(buildRoot, 'external');
const inlineDir = resolve(buildRoot, 'inline');
const bundleDir = resolve(buildRoot, 'bundle');
const noColumnsDir = resolve(buildRoot, 'no-columns');
const inlineFbSourcesExtendedDir = resolve(inlineDir, 'fb-sources-extended');
const externalFbSourcesExtendedDir = resolve(
  externalDir,
  'fb-sources-extended',
);
const inlineReactSourcesExtendedDir = resolve(
  inlineDir,
  'react-sources-extended',
);
const externalReactSourcesExtendedDir = resolve(
  externalDir,
  'react-sources-extended',
);

// Remove previous builds
emptyDirSync(buildRoot);
mkdirSync(externalDir);
mkdirSync(inlineDir);
mkdirSync(bundleDir);
mkdirSync(noColumnsDir);
mkdirSync(inlineFbSourcesExtendedDir);
mkdirSync(externalFbSourcesExtendedDir);
mkdirSync(inlineReactSourcesExtendedDir);
mkdirSync(externalReactSourcesExtendedDir);

function compile(fileName) {
  const code = readFileSync(resolve(sourceDir, fileName), 'utf8');

  const transformed = transformSync(code, {
    plugins: ['@babel/plugin-transform-modules-commonjs'],
    presets: [
      // 'minify',
      [
        '@babel/react',
        // {
        //   runtime: 'automatic',
        //   development: false,
        // },
      ],
    ],
    sourceMap: true,
  });

  const sourceMap = transformed.map;
  sourceMap.sources = [fileName];

  // Generate compiled output with external source maps
  writeFileSync(
    resolve(externalDir, fileName),
    transformed.code + `\n//# sourceMappingURL=${fileName}.map`,
    'utf8',
  );
  writeFileSync(
    resolve(externalDir, `${fileName}.map`),
    JSON.stringify(sourceMap),
    'utf8',
  );

  // Generate compiled output with inline base64 source maps
  writeFileSync(
    resolve(inlineDir, fileName),
    transformed.code +
      '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' +
      btoa(JSON.stringify(sourceMap)),
    'utf8',
  );

  // Strip column numbers from source map to mimic Webpack 'cheap-module-source-map'
  // The mappings field represents a list of integer arrays.
  // Each array defines a pair of corresponding file locations, one in the generated code and one in the original.
  // Each array has also been encoded first as VLQs (variable-length quantities)
  // and then as base64 because this makes them more compact overall.
  // https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/view#
  const decodedMappings = decode(sourceMap.mappings).map(entries =>
    entries.map(entry => {
      if (entry.length === 0) {
        return entry;
      }

      // Each non-empty segment has the following components:
      // generated code column, source index, source code line, source code column, and (optional) name index
      return [...entry.slice(0, 3), 0, ...entry.slice(4)];
    }),
  );
  const encodedMappings = encode(decodedMappings);

  // Generate compiled output with inline base64 source maps without column numbers
  writeFileSync(
    resolve(noColumnsDir, fileName),
    transformed.code +
      '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' +
      btoa(
        JSON.stringify({
          ...sourceMap,
          mappings: encodedMappings,
        }),
      ),
    'utf8',
  );

  // Generate compiled output with an extended sourcemap that
  // includes a map of hook names.
  const parsed = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'flow'],
  });
  const encodedHookMap = generateEncodedHookMap(parsed);
  const fbSourcesExtendedSourceMap = {
    ...sourceMap,
    // When using the x_facebook_sources extension field, the first item
    // for a given source is reserved for the Function Map, and the
    // React sources metadata (which includes the Hook Map) is added as
    // the second item.
    x_facebook_sources: [[null, [encodedHookMap]]],
  };
  const reactSourcesExtendedSourceMap = {
    ...sourceMap,
    // When using the x_react_sources extension field, the first item
    // for a given source is reserved for the Hook Map.
    x_react_sources: [[encodedHookMap]],
  };

  // Using the x_facebook_sources field
  writeFileSync(
    resolve(inlineFbSourcesExtendedDir, fileName),
    transformed.code +
      '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' +
      btoa(JSON.stringify(fbSourcesExtendedSourceMap)),
    'utf8',
  );
  writeFileSync(
    resolve(externalFbSourcesExtendedDir, fileName),
    transformed.code + `\n//# sourceMappingURL=${fileName}.map`,
    'utf8',
  );
  writeFileSync(
    resolve(externalFbSourcesExtendedDir, `${fileName}.map`),
    JSON.stringify(fbSourcesExtendedSourceMap),
    'utf8',
  );

  // Using the x_react_sources field
  writeFileSync(
    resolve(inlineReactSourcesExtendedDir, fileName),
    transformed.code +
      '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' +
      btoa(JSON.stringify(reactSourcesExtendedSourceMap)),
    'utf8',
  );
  writeFileSync(
    resolve(externalReactSourcesExtendedDir, fileName),
    transformed.code + `\n//# sourceMappingURL=${fileName}.map`,
    'utf8',
  );
  writeFileSync(
    resolve(externalReactSourcesExtendedDir, `${fileName}.map`),
    JSON.stringify(reactSourcesExtendedSourceMap),
    'utf8',
  );
}

async function bundle() {
  const entryFileName = resolve(sourceDir, 'index.js');

  // Bundle all modules with rollup
  const result = await rollup.rollup({
    input: entryFileName,
    acornInjectPlugins: [jsx()],
    plugins: [
      rollupResolve(),
      commonjs(),
      babel({presets: ['@babel/preset-react'], sourceMap: true}),
    ],
    external: ['react'],
  });
  await result.write({
    file: resolve(bundleDir, 'index.js'),
    format: 'cjs',
    sourcemap: true,
  });
}

// Compile all files in the current directory
const entries = readdirSync(sourceDir);
entries.forEach(entry => {
  const stat = lstatSync(resolve(sourceDir, entry));
  if (!stat.isDirectory() && entry.endsWith('.js')) {
    compile(entry);
  }
});

bundle().catch(e => {
  console.error(e);
  process.exit(1);
});
