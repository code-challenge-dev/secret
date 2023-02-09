/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Parsing source and source maps is done in a Web Worker
// because parsing is CPU intensive and should not block the UI thread.
//
// Fetching source and source map files is intentionally done on the UI thread
// so that loaded source files can reuse the browser's Network cache.
// Requests made from within an extension do not share the page's Network cache,
// but messages can be sent from the UI thread to the content script
// which can make a request from the page's context (with caching).
//
// Some overhead may be incurred sharing (serializing) the loaded data between contexts,
// but less than fetching the file to begin with,
// and in some cases we can avoid serializing the source code at all
// (e.g. when we are in an environment that supports our custom metadata format).
//
// The overall flow of this file is such:
// 1. Find the Set of source files defining the hooks and load them all.
//    Then for each source file, do the following:
//
//    a. Search loaded source file to see if a source map is available.
//       If so, load that file and pass it to a Worker for parsing.
//       The source map is used to retrieve the original source,
//       which is then also parsed in the Worker to infer hook names.
//       This is less ideal because parsing a full source map is slower,
//       since we need to evaluate the mappings in order to map the runtime code to the original source,
//       but at least the eventual source that we parse to an AST is small/fast.
//
//    b. If no source map, pass the full source to a Worker for parsing.
//       Use the source to infer hook names.
//       This is the least optimal route as parsing the full source is very CPU intensive.
//
// In the future, we may add an additional optimization the above sequence.
// This check would come before the source map check:
//
//    a. Search loaded source file to see if a custom React metadata file is available.
//       If so, load that file and pass it to a Worker for parsing and extracting.
//       This is the fastest option since our custom metadata file is much smaller than a full source map,
//       and there is no need to convert runtime code to the original source.

import {__DEBUG__} from 'react-devtools-shared/src/constants';
import {getHookSourceLocationKey} from 'react-devtools-shared/src/hookNamesCache';
import {sourceMapIncludesSource} from '../SourceMapUtils';
import {
  withAsyncPerfMeasurements,
  withCallbackPerfMeasurements,
  withSyncPerfMeasurements,
} from 'react-devtools-shared/src/PerformanceLoggingUtils';

import type {
  HooksNode,
  HookSource,
  HooksTree,
} from 'react-debug-tools/src/ReactDebugHooks';
import type {MixedSourceMap} from '../SourceMapTypes';
import type {FetchFileWithCaching} from 'react-devtools-shared/src/devtools/views/Components/FetchFileWithCachingContext';

// Prefer a cached albeit stale response to reduce download time.
// We wouldn't want to load/parse a newer version of the source (even if one existed).
const FETCH_OPTIONS = {cache: 'force-cache'};

const MAX_SOURCE_LENGTH = 100_000_000;

export type HookSourceAndMetadata = {
  // Generated by react-debug-tools.
  hookSource: HookSource,

  // Compiled code (React components or custom hooks) containing primitive hook calls.
  runtimeSourceCode: string | null,

  // Same as hookSource.fileName but guaranteed to be non-null.
  runtimeSourceURL: string,

  // Raw source map JSON.
  // Either decoded from an inline source map or loaded from an externa source map file.
  // Sources without source maps won't have this.
  sourceMapJSON: MixedSourceMap | null,

  // External URL of source map.
  // Sources without source maps (or with inline source maps) won't have this.
  sourceMapURL: string | null,
};

export type LocationKeyToHookSourceAndMetadata = Map<
  string,
  HookSourceAndMetadata,
>;
export type HooksList = Array<HooksNode>;

export async function loadSourceAndMetadata(
  hooksList: HooksList,
  fetchFileWithCaching: FetchFileWithCaching | null,
): Promise<LocationKeyToHookSourceAndMetadata> {
  return withAsyncPerfMeasurements('loadSourceAndMetadata()', async () => {
    const locationKeyToHookSourceAndMetadata = withSyncPerfMeasurements(
      'initializeHookSourceAndMetadata',
      () => initializeHookSourceAndMetadata(hooksList),
    );

    await withAsyncPerfMeasurements('loadSourceFiles()', () =>
      loadSourceFiles(locationKeyToHookSourceAndMetadata, fetchFileWithCaching),
    );

    await withAsyncPerfMeasurements('extractAndLoadSourceMapJSON()', () =>
      extractAndLoadSourceMapJSON(locationKeyToHookSourceAndMetadata),
    );

    // At this point, we've loaded JS source (text) and source map (JSON).
    // The remaining works (parsing these) is CPU intensive and should be done in a worker.
    return locationKeyToHookSourceAndMetadata;
  });
}

function decodeBase64String(encoded: string): Object {
  if (typeof atob === 'function') {
    return atob(encoded);
  } else if (
    typeof Buffer !== 'undefined' &&
    Buffer !== null &&
    typeof Buffer.from === 'function'
  ) {
    return Buffer.from(encoded, 'base64');
  } else {
    throw Error('Cannot decode base64 string');
  }
}

function extractAndLoadSourceMapJSON(
  locationKeyToHookSourceAndMetadata: LocationKeyToHookSourceAndMetadata,
): Promise<Array<$Call<<T>(p: Promise<T> | T) => T, Promise<void>>>> {
  // Deduplicate fetches, since there can be multiple location keys per source map.
  const dedupedFetchPromises = new Map<string, Promise<$FlowFixMe>>();

  if (__DEBUG__) {
    console.log(
      'extractAndLoadSourceMapJSON() load',
      locationKeyToHookSourceAndMetadata.size,
      'source maps',
    );
  }

  const setterPromises = [];
  locationKeyToHookSourceAndMetadata.forEach(hookSourceAndMetadata => {
    const sourceMapRegex = / ?sourceMappingURL=([^\s'"]+)/gm;
    const runtimeSourceCode =
      ((hookSourceAndMetadata.runtimeSourceCode: any): string);

    // TODO (named hooks) Search for our custom metadata first.
    // If it's found, we should use it rather than source maps.

    // TODO (named hooks) If this RegExp search is slow, we could try breaking it up
    // first using an indexOf(' sourceMappingURL=') to find the start of the comment
    // (probably at the end of the file) and then running the RegExp on the remaining substring.
    let sourceMappingURLMatch = withSyncPerfMeasurements(
      'sourceMapRegex.exec(runtimeSourceCode)',
      () => sourceMapRegex.exec(runtimeSourceCode),
    );

    if (sourceMappingURLMatch == null) {
      if (__DEBUG__) {
        console.log('extractAndLoadSourceMapJSON() No source map found');
      }

      // Maybe file has not been transformed; we'll try to parse it as-is in parseSourceAST().
    } else {
      const externalSourceMapURLs = [];
      while (sourceMappingURLMatch != null) {
        const {runtimeSourceURL} = hookSourceAndMetadata;
        const sourceMappingURL = sourceMappingURLMatch[1];
        const hasInlineSourceMap = sourceMappingURL.indexOf('base64,') >= 0;
        if (hasInlineSourceMap) {
          try {
            // TODO (named hooks) deduplicate parsing in this branch (similar to fetching in the other branch)
            // since there can be multiple location keys per source map.

            // Web apps like Code Sandbox embed multiple inline source maps.
            // In this case, we need to loop through and find the right one.
            // We may also need to trim any part of this string that isn't based64 encoded data.
            const trimmed = ((sourceMappingURL.match(
              /base64,([a-zA-Z0-9+\/=]+)/,
            ): any): Array<string>)[1];
            const decoded = withSyncPerfMeasurements(
              'decodeBase64String()',
              () => decodeBase64String(trimmed),
            );

            const sourceMapJSON = withSyncPerfMeasurements(
              'JSON.parse(decoded)',
              () => JSON.parse(decoded),
            );

            if (__DEBUG__) {
              console.groupCollapsed(
                'extractAndLoadSourceMapJSON() Inline source map',
              );
              console.log(sourceMapJSON);
              console.groupEnd();
            }

            // Hook source might be a URL like "https://4syus.csb.app/src/App.js"
            // Parsed source map might be a partial path like "src/App.js"
            if (sourceMapIncludesSource(sourceMapJSON, runtimeSourceURL)) {
              hookSourceAndMetadata.sourceMapJSON = sourceMapJSON;

              // OPTIMIZATION If we've located a source map for this source,
              // we'll use it to retrieve the original source (to extract hook names).
              // We only fall back to parsing the full source code is when there's no source map.
              // The source is (potentially) very large,
              // So we can avoid the overhead of serializing it unnecessarily.
              hookSourceAndMetadata.runtimeSourceCode = null;

              break;
            }
          } catch (error) {
            // We've likely encountered a string in the source code that looks like a source map but isn't.
            // Maybe the source code contains a "sourceMappingURL" comment or soething similar.
            // In either case, let's skip this and keep looking.
          }
        } else {
          externalSourceMapURLs.push(sourceMappingURL);
        }

        // If the first source map we found wasn't a match, check for more.
        sourceMappingURLMatch = withSyncPerfMeasurements(
          'sourceMapRegex.exec(runtimeSourceCode)',
          () => sourceMapRegex.exec(runtimeSourceCode),
        );
      }

      if (hookSourceAndMetadata.sourceMapJSON === null) {
        externalSourceMapURLs.forEach((sourceMappingURL, index) => {
          if (index !== externalSourceMapURLs.length - 1) {
            // Files with external source maps should only have a single source map.
            // More than one result might indicate an edge case,
            // like a string in the source code that matched our "sourceMappingURL" regex.
            // We should just skip over cases like this.
            console.warn(
              `More than one external source map detected in the source file; skipping "${sourceMappingURL}"`,
            );
            return;
          }

          const {runtimeSourceURL} = hookSourceAndMetadata;
          let url = sourceMappingURL;
          if (!url.startsWith('http') && !url.startsWith('/')) {
            // Resolve paths relative to the location of the file name
            const lastSlashIdx = runtimeSourceURL.lastIndexOf('/');
            if (lastSlashIdx !== -1) {
              const baseURL = runtimeSourceURL.slice(
                0,
                runtimeSourceURL.lastIndexOf('/'),
              );
              url = `${baseURL}/${url}`;
            }
          }

          hookSourceAndMetadata.sourceMapURL = url;

          const fetchPromise =
            dedupedFetchPromises.get(url) ||
            fetchFile(url).then(
              sourceMapContents => {
                const sourceMapJSON = withSyncPerfMeasurements(
                  'JSON.parse(sourceMapContents)',
                  () => JSON.parse(sourceMapContents),
                );

                return sourceMapJSON;
              },

              // In this case, we fall back to the assumption that the source has no source map.
              // This might indicate an (unlikely) edge case that had no source map,
              // but contained the string "sourceMappingURL".
              error => null,
            );

          if (__DEBUG__) {
            if (!dedupedFetchPromises.has(url)) {
              console.log(
                `extractAndLoadSourceMapJSON() External source map "${url}"`,
              );
            }
          }

          dedupedFetchPromises.set(url, fetchPromise);

          setterPromises.push(
            fetchPromise.then(sourceMapJSON => {
              if (sourceMapJSON !== null) {
                hookSourceAndMetadata.sourceMapJSON = sourceMapJSON;

                // OPTIMIZATION If we've located a source map for this source,
                // we'll use it to retrieve the original source (to extract hook names).
                // We only fall back to parsing the full source code is when there's no source map.
                // The source is (potentially) very large,
                // So we can avoid the overhead of serializing it unnecessarily.
                hookSourceAndMetadata.runtimeSourceCode = null;
              }
            }),
          );
        });
      }
    }
  });

  return Promise.all(setterPromises);
}

function fetchFile(
  url: string,
  markName?: string = 'fetchFile',
): Promise<string> {
  return withCallbackPerfMeasurements(`${markName}("${url}")`, done => {
    return new Promise((resolve, reject) => {
      fetch(url, FETCH_OPTIONS).then(
        response => {
          if (response.ok) {
            response
              .text()
              .then(text => {
                done();
                resolve(text);
              })
              .catch(error => {
                if (__DEBUG__) {
                  console.log(
                    `${markName}() Could not read text for url "${url}"`,
                  );
                }
                done();
                reject(null);
              });
          } else {
            if (__DEBUG__) {
              console.log(`${markName}() Got bad response for url "${url}"`);
            }
            done();
            reject(null);
          }
        },
        error => {
          if (__DEBUG__) {
            console.log(`${markName}() Could not fetch file: ${error.message}`);
          }
          done();
          reject(null);
        },
      );
    });
  });
}

export function hasNamedHooks(hooksTree: HooksTree): boolean {
  for (let i = 0; i < hooksTree.length; i++) {
    const hook = hooksTree[i];

    if (!isUnnamedBuiltInHook(hook)) {
      return true;
    }

    if (hook.subHooks.length > 0) {
      if (hasNamedHooks(hook.subHooks)) {
        return true;
      }
    }
  }

  return false;
}

export function flattenHooksList(hooksTree: HooksTree): HooksList {
  const hooksList: HooksList = [];
  withSyncPerfMeasurements('flattenHooksList()', () => {
    flattenHooksListImpl(hooksTree, hooksList);
  });

  if (__DEBUG__) {
    console.log('flattenHooksList() hooksList:', hooksList);
  }

  return hooksList;
}

function flattenHooksListImpl(
  hooksTree: HooksTree,
  hooksList: Array<HooksNode>,
): void {
  for (let i = 0; i < hooksTree.length; i++) {
    const hook = hooksTree[i];

    if (isUnnamedBuiltInHook(hook)) {
      // No need to load source code or do any parsing for unnamed hooks.
      if (__DEBUG__) {
        console.log('flattenHooksListImpl() Skipping unnamed hook', hook);
      }

      continue;
    }

    hooksList.push(hook);

    if (hook.subHooks.length > 0) {
      flattenHooksListImpl(hook.subHooks, hooksList);
    }
  }
}

function initializeHookSourceAndMetadata(
  hooksList: Array<HooksNode>,
): LocationKeyToHookSourceAndMetadata {
  // Create map of unique source locations (file names plus line and column numbers) to metadata about hooks.
  const locationKeyToHookSourceAndMetadata: LocationKeyToHookSourceAndMetadata =
    new Map();
  for (let i = 0; i < hooksList.length; i++) {
    const hook = hooksList[i];

    const hookSource = hook.hookSource;
    if (hookSource == null) {
      // Older versions of react-debug-tools don't include this information.
      // In this case, we can't continue.
      throw Error('Hook source code location not found.');
    }

    const locationKey = getHookSourceLocationKey(hookSource);
    if (!locationKeyToHookSourceAndMetadata.has(locationKey)) {
      // Can't be null because getHookSourceLocationKey() would have thrown
      const runtimeSourceURL = ((hookSource.fileName: any): string);

      const hookSourceAndMetadata: HookSourceAndMetadata = {
        hookSource,
        runtimeSourceCode: null,
        runtimeSourceURL,
        sourceMapJSON: null,
        sourceMapURL: null,
      };

      locationKeyToHookSourceAndMetadata.set(
        locationKey,
        hookSourceAndMetadata,
      );
    }
  }

  return locationKeyToHookSourceAndMetadata;
}

// Determines whether incoming hook is a primitive hook that gets assigned to variables.
function isUnnamedBuiltInHook(hook: HooksNode) {
  return ['Effect', 'ImperativeHandle', 'LayoutEffect', 'DebugValue'].includes(
    hook.name,
  );
}

function loadSourceFiles(
  locationKeyToHookSourceAndMetadata: LocationKeyToHookSourceAndMetadata,
  fetchFileWithCaching: FetchFileWithCaching | null,
): Promise<Array<$Call<<T>(p: Promise<T> | T) => T, Promise<void>>>> {
  // Deduplicate fetches, since there can be multiple location keys per file.
  const dedupedFetchPromises = new Map<string, Promise<$FlowFixMe>>();

  const setterPromises = [];
  locationKeyToHookSourceAndMetadata.forEach(hookSourceAndMetadata => {
    const {runtimeSourceURL} = hookSourceAndMetadata;

    let fetchFileFunction = fetchFile;
    if (fetchFileWithCaching != null) {
      // If a helper function has been injected to fetch with caching,
      // use it to fetch the (already loaded) source file.
      fetchFileFunction = url => {
        return withAsyncPerfMeasurements(
          `fetchFileWithCaching("${url}")`,
          () => {
            return ((fetchFileWithCaching: any): FetchFileWithCaching)(url);
          },
        );
      };
    }

    const fetchPromise =
      dedupedFetchPromises.get(runtimeSourceURL) ||
      fetchFileFunction(runtimeSourceURL).then(runtimeSourceCode => {
        // TODO (named hooks) Re-think this; the main case where it matters is when there's no source-maps,
        // because then we need to parse the full source file as an AST.
        if (runtimeSourceCode.length > MAX_SOURCE_LENGTH) {
          throw Error('Source code too large to parse');
        }

        if (__DEBUG__) {
          console.groupCollapsed(
            `loadSourceFiles() runtimeSourceURL "${runtimeSourceURL}"`,
          );
          console.log(runtimeSourceCode);
          console.groupEnd();
        }

        return runtimeSourceCode;
      });
    dedupedFetchPromises.set(runtimeSourceURL, fetchPromise);

    setterPromises.push(
      fetchPromise.then(runtimeSourceCode => {
        hookSourceAndMetadata.runtimeSourceCode = runtimeSourceCode;
      }),
    );
  });

  return Promise.all(setterPromises);
}
