// @flow

import {
  ElementTypeClass,
  ElementTypeFunction,
  ElementTypeRoot,
  ElementTypeOtherOrUnknown,
} from 'src/types';
import { getUID, utfEncodeString, printOperationsArray } from '../../utils';
import { cleanForBridge, copyWithSet } from '../utils';
import {
  __DEBUG__,
  TREE_OPERATION_ADD,
  TREE_OPERATION_REMOVE,
  TREE_OPERATION_REORDER_CHILDREN,
} from '../../constants';
import getChildren from './getChildren';
import getData from './getData';
import getElementType from './getElementType';
import {
  decorateResult,
  decorateMany,
  forceUpdate,
  restoreMany,
} from './utils';

import type {
  DevToolsHook,
  GetFiberIDForNative,
  NativeType,
  PathFrame,
  PathMatch,
  RendererInterface,
} from '../types';
import type { ComponentFilter } from 'src/types';
import type {
  InspectedElement,
  Owner,
} from 'src/devtools/views/Components/types';

export type InternalInstance = Object;
type LegacyRenderer = Object;

export function attach(
  hook: DevToolsHook,
  rendererID: number,
  renderer: LegacyRenderer,
  global: Object
): RendererInterface {
  const idToInternalInstanceMap: Map<number, InternalInstance> = new Map();
  const idToParentIDMap: Map<number, number> = new Map();
  const internalInstanceToIDMap: Map<InternalInstance, number> = new Map();
  const internalInstanceToLastKnownChildrenMap: WeakMap<
    InternalInstance,
    Array<number>
  > = new WeakMap();
  const rootIDs: Set<number> = new Set();

  function getID(internalInstance: InternalInstance): number {
    if (typeof internalInstance !== 'object') {
      throw new Error('Invalid internal instance: ' + internalInstance);
    }
    if (!internalInstanceToIDMap.has(internalInstance)) {
      const id = getUID();
      internalInstanceToIDMap.set(internalInstance, id);
      idToInternalInstanceMap.set(id, internalInstance);
    }
    return ((internalInstanceToIDMap.get(internalInstance): any): number);
  }

  function getChildIDs(internalInstance: InternalInstance): Array<number> {
    return getChildren(internalInstance).map(getID);
  }

  function findNearestAncestorInTree(
    internalInstance: InternalInstance
  ): number | null {
    let current = internalInstance;
    while (current != null) {
      const id = getID(current);
      if (
        rootIDs.has(id) ||
        getElementType(current) !== ElementTypeOtherOrUnknown
      ) {
        return id;
      }
      const parentID = idToParentIDMap.get(id);
      current = parentID != null ? idToInternalInstanceMap.get(parentID) : null;
    }
    return null;
  }

  let getInternalIDForNative: GetFiberIDForNative = ((null: any): GetFiberIDForNative);
  let findNativeNodeForInternalID: (id: number) => ?NativeType;

  // React Native
  if (renderer.Mount.findNodeHandle && renderer.Mount.nativeTagToRootNodeID) {
    getInternalIDForNative = (nativeTag, findNearestUnfilteredAncestor) => {
      const internalInstance = renderer.Mount.nativeTagToRootNodeID(nativeTag);
      return findNearestAncestorInTree(internalInstance);
    };
    findNativeNodeForInternalID = (id: number) => {
      const internalInstance = idToInternalInstanceMap.get(id);
      return renderer.Mount.findNodeHandle(internalInstance);
    };

    // React DOM 15+
  } else if (renderer.ComponentTree) {
    getInternalIDForNative = (node, findNearestUnfilteredAncestor) => {
      const internalInstance = renderer.ComponentTree.getClosestInstanceFromNode(
        node
      );
      return findNearestAncestorInTree(internalInstance);
    };
    findNativeNodeForInternalID = (id: number) => {
      const internalInstance = idToInternalInstanceMap.get(id);
      return renderer.ComponentTree.getNodeFromInstance(internalInstance);
    };

    // React DOM
  } else if (renderer.Mount.getID && renderer.Mount.getNode) {
    getInternalIDForNative = (node, findNearestUnfilteredAncestor) => {
      let id = renderer.Mount.getID(node);
      while (node && node.parentNode && !id) {
        node = node.parentNode;
        id = renderer.Mount.getID(node);
      }
      return id;
    };

    findNativeNodeForInternalID = (id: number) => {
      try {
        const internalInstance = idToInternalInstanceMap.get(id);
        if (internalInstance != null) {
          return renderer.Mount.getNode(internalInstance._rootNodeID);
        }
      } catch (e) {}

      return null;
    };
  } else {
    console.warn(
      'Unknown React version (does not have getID), probably an unshimmed React Native'
    );
  }

  let oldReconcilerMethods = null;
  let oldRenderComponent = null;
  let oldRenderRoot = null;

  // React DOM
  if (renderer.Mount._renderNewRootComponent) {
    oldRenderRoot = decorateResult(
      renderer.Mount,
      '_renderNewRootComponent',
      internalInstance => {
        // TODO: we might need to reset currentParentID before this runs.

        const id = getID(internalInstance);
        rootIDs.add(id);

        if (__DEBUG__) {
          console.log('renderer.Mount._renderNewRootComponent()', id);
        }

        // TODO: maybe we need to record this mount.
        // Needs testing.

        // If we're mounting a root, we've just finished a batch of work,
        // so it's safe to synchronously flush.
        flushPendingEvents(id);
      }
    );

    // React Native
  } else if (renderer.Mount.renderComponent) {
    oldRenderComponent = decorateResult(
      renderer.Mount,
      'renderComponent',
      internalInstance => {
        // TODO: we might need to reset currentParentID before this runs.

        const id = getID(internalInstance);
        rootIDs.add(id);

        if (__DEBUG__) {
          console.log('renderer.Mount.renderComponent()', id);
        }

        // TODO: maybe we need to record this mount.
        // Needs testing.

        // If we're mounting a root, we've just finished a batch of work,
        // so it's safe to synchronously flush.
        flushPendingEvents(id);
      }
    );
  }

  // This is shared mutable state that lets us keep track of where we are.
  let currentParentID = 0;

  if (renderer.Reconciler) {
    oldReconcilerMethods = decorateMany(renderer.Reconciler, {
      mountComponent(fn, args) {
        const [internalInstance] = args;

        recordPendingMount(internalInstance);

        let prevParentID = currentParentID;
        currentParentID = getID(internalInstance);
        const result = fn.apply(this, args);
        currentParentID = prevParentID;

        return result;
      },
      performUpdateIfNecessary(fn, args) {
        const [internalInstance] = args;

        let prevParentID = currentParentID;
        currentParentID = getID(internalInstance);
        const result = fn.apply(this, args);
        currentParentID = prevParentID;

        recordPendingReorder(internalInstance);
        return result;
      },
      receiveComponent(fn, args) {
        const [internalInstance] = args;

        let prevParentID = currentParentID;
        currentParentID = getID(internalInstance);
        const result = fn.apply(this, args);
        currentParentID = prevParentID;

        recordPendingReorder(internalInstance);
        return result;
      },
      unmountComponent(fn, args) {
        const [internalInstance] = args;

        const result = fn.apply(this, args);

        recordPendingUnmount(internalInstance);
        return result;
      },
    });
  }

  function cleanup() {
    if (oldReconcilerMethods !== null) {
      if (renderer.Component) {
        restoreMany(renderer.Component.Mixin, oldReconcilerMethods);
      } else {
        restoreMany(renderer.Reconciler, oldReconcilerMethods);
      }
    }
    if (oldRenderRoot !== null) {
      renderer.Mount._renderNewRootComponent = oldRenderRoot;
    }
    if (oldRenderComponent !== null) {
      renderer.Mount.renderComponent = oldRenderComponent;
    }
    oldReconcilerMethods = null;
    oldRenderRoot = null;
    oldRenderComponent = null;
  }

  const pendingMountIDs: Set<number> = new Set();
  const pendingUnmountIDs: Set<number> = new Set();
  const pendingReorderIDs: Set<number> = new Set();
  const pendingOperations: Array<number> = [];
  const pendingStringTable: Map<string, number> = new Map();
  let pendingStringTableLength: number = 0;
  let pendingUnmountedRootID: number | null = null;

  function pushOperation(op: number): void {
    if (__DEV__) {
      if (!Number.isInteger(op)) {
        console.error(
          'pushOperation() was called but the value is not an integer.',
          op
        );
      }
    }
    pendingOperations.push(op);
  }

  // TODO Rethink the below queueing mechanism.
  // Every mount is some parent's update (except for the root mount which we can explicitly handle)
  // So maybe we only need to call queueFlushPendingEvents() for updates,
  // and maybe we can rely on an id-to-root Map for this case, to limit the scope of what  we crawl.

  // Older React renderers did not have the concept of a commit.
  // The data structure was just ad-hoc mutated in place.
  // So except for the case of the root mounting the first time,
  // there is no event we can observe to signal that a render is finished.
  // However since older renderers were always synchronous,
  // we can use setTimeout to batch operations together.
  // In the case of a cascading update, we might batch multiple "commits"-
  // but that should be okay, since the batching is not strictly necessary.
  let flushPendingEventsTimeoutID: TimeoutID | null = null;
  function queueFlushPendingEvents() {
    if (flushPendingEventsTimeoutID === null) {
      flushPendingEventsTimeoutID = setTimeout(() => {
        flushPendingEventsTimeoutID = null;

        // If there are pending operations, walk the tree and find them.
        // Ideally we wouldjust pluck the pending operations out of the sets directly,
        // but without doing a full traversal, it would be hard for us to determine the filtered parent.
        // It should be possible to improve this though, by maintaining a map of id-to-parent,
        // and crawling upward to the first non-filtered node.
        // TODO Revisit this and think about it more...
        if (
          pendingMountIDs.size > 0 ||
          pendingUnmountIDs.size > 0 ||
          pendingReorderIDs.size > 0
        ) {
          rootIDs.forEach(flushPendingEvents);
        }
      }, 0);
    }
  }

  function flushInitialOperations() {
    // Older versions of React do not support profiling mode, so there's nothing to flush.
    // Crawl roots though and register any nodes that mounted before we were injected.

    const roots =
      renderer.Mount._instancesByReactRootID ||
      renderer.Mount._instancesByContainerID;

    for (let key in roots) {
      const internalInstance = roots[key];
      const id = getID(internalInstance);

      rootIDs.add(id);

      crawlAndRecordInitialMounts(id, 0);

      // It's safe to synchronously flush for the root we just crawled.
      flushPendingEvents(id);
    }
  }

  // TODO: this isn't covered by tests.
  // Might be broken.
  function crawlAndRecordInitialMounts(id: number, parentID: number) {
    const internalInstance = idToInternalInstanceMap.get(id);

    // Not all nodes are mounted in the frontend DevTools tree,
    // but it's important to track parent info even for the unmounted ones.
    idToParentIDMap.set(id, parentID);

    if (__DEBUG__) {
      console.group('crawlAndRecordInitialMounts() id:', id);
    }

    recordMount(id, parentID);
    getChildIDs(internalInstance).forEach(childID =>
      crawlAndRecordInitialMounts(childID, id)
    );

    if (__DEBUG__) {
      console.groupEnd();
    }
  }

  function flushPendingEvents(rootID: number): void {
    // Record pending deletions.
    const unmountIDs = [];
    pendingUnmountIDs.forEach(id => {
      const internalInstance = idToInternalInstanceMap.get(id);
      const isRoot = rootIDs.has(id);

      if (__DEBUG__) {
        console.log(
          '%crecordUnmount()',
          'color: red; font-weight: bold;',
          id,
          getData(internalInstance).displayName
        );
      }

      // TODO: handle the case where it was never mounted.
      if (isRoot) {
        pendingUnmountedRootID = id;
        rootIDs.delete(id);
      } else {
        unmountIDs.push(id);
      }

      idToInternalInstanceMap.delete(id);
      internalInstanceToIDMap.delete(internalInstance);
    });

    pendingMountIDs.forEach(id => {
      if (pendingUnmountIDs.has(id)) {
        return;
      }
      const parentID = idToParentIDMap.get(id);
      if (parentID === undefined) {
        return;
      }
      recordMount(id, parentID);
    });

    const numUnmountIDs =
      unmountIDs.length + (pendingUnmountedRootID === null ? 0 : 1);

    const reorderOperations = computePendingReorderOperations();
    const operations = new Uint32Array(
      // Identify which renderer this update is coming from.
      2 + // [rendererID, rootFiberID]
      // How big is the string table?
      1 + // [stringTableLength]
        // Then goes the actual string table.
        pendingStringTableLength +
        // All unmounts are batched in a single message.
        // [TREE_OPERATION_REMOVE, removedIDLength, ...ids]
        (numUnmountIDs > 0 ? 2 + numUnmountIDs : 0) +
        // Mount operations
        pendingOperations.length +
        // Reorder operation come last because
        // bridge expects them to not change children length.
        // So both mounts and unmounts need to have happened by now.
        reorderOperations.length
    );

    // Identify which renderer this update is coming from.
    // This enables roots to be mapped to renderers,
    // Which in turn enables fiber properations, states, and hooks to be inspected.
    let i = 0;
    operations[i++] = rendererID;
    operations[i++] = rootID;

    // Now fill in the string table.
    // [stringTableLength, str1Length, ...str1, str2Length, ...str2, ...]
    operations[i++] = pendingStringTableLength;
    pendingStringTable.forEach((value, key) => {
      operations[i++] = key.length;
      operations.set(utfEncodeString(key), i);
      i += key.length;
    });

    if (numUnmountIDs > 0) {
      // All unmounts except roots are batched in a single message.
      operations[i++] = TREE_OPERATION_REMOVE;
      // The first number is how many unmounted IDs we're gonna send.
      operations[i++] = numUnmountIDs;
      // Fill in the unmounts
      for (let j = 0; j < unmountIDs.length; j++) {
        operations[i++] = unmountIDs[j];
      }
      // The root ID should always be unmounted last.
      if (pendingUnmountedRootID !== null) {
        operations[i] = pendingUnmountedRootID;
        i++;
      }
    }

    // Fill in the rest of the operations.
    operations.set(pendingOperations, i);
    i += pendingOperations.length;

    operations.set(reorderOperations, i);

    if (__DEBUG__) {
      printOperationsArray(operations);
    }

    // If we've already connected to the frontend, just pass the operations through.
    hook.emit('operations', operations);

    pendingOperations.length = 0;
    pendingMountIDs.clear();
    pendingReorderIDs.clear();
    pendingUnmountIDs.clear();
    pendingUnmountedRootID = null;
    pendingStringTable.clear();
    pendingStringTableLength = 0;
  }

  function computePendingReorderOperations(): Array<number> {
    const ops = [];
    pendingReorderIDs.forEach(id => {
      const internalInstance = idToInternalInstanceMap.get(id);
      if (internalInstance === undefined) {
        return;
      }
      const prevChildIDs = internalInstanceToLastKnownChildrenMap.get(
        internalInstance
      );
      const nextChildIDs = getChildIDs(internalInstance);
      internalInstanceToLastKnownChildrenMap.set(
        internalInstance,
        nextChildIDs
      );

      let shouldResetChildren = false;
      if (prevChildIDs === undefined) {
        // We haven't computed children before.
        // So we'll have to do it now.
        // Next time they'll be cached for comparison
        // TODO: this might not make sense. Revisit.
        shouldResetChildren = true;
      } else if (nextChildIDs.length > 1) {
        if (prevChildIDs.length !== nextChildIDs.length) {
          shouldResetChildren = true;
        } else {
          for (let i = 0; i < prevChildIDs.length; i++) {
            if (prevChildIDs[i] !== nextChildIDs[i]) {
              shouldResetChildren = true;
              break;
            }
          }
        }
      }
      if (shouldResetChildren) {
        ops.push(TREE_OPERATION_REORDER_CHILDREN);
        ops.push(getID(internalInstance));
        ops.push(nextChildIDs.length);
        for (let i = 0; i < nextChildIDs.length; i++) {
          ops.push(nextChildIDs[i]);
        }
      }
    });
    return ops;
  }

  function getStringID(str: string | null): number {
    if (str === null) {
      return 0;
    }
    const existingID = pendingStringTable.get(str);
    if (existingID !== undefined) {
      return existingID;
    }
    const stringID = pendingStringTable.size + 1;
    pendingStringTable.set(str, stringID);
    // The string table total length needs to account
    // both for the string length, and for the array item
    // that contains the length itself. Hence + 1.
    pendingStringTableLength += str.length + 1;
    return stringID;
  }

  function inspectElement(id: number): InspectedElement | null {
    let result = inspectElementRaw(id);
    if (result === null) {
      return null;
    }
    // TODO Review sanitization approach for the below inspectable values.
    result.context = cleanForBridge(result.context);
    result.props = cleanForBridge(result.props);
    result.state = cleanForBridge(result.state);
    return result;
  }

  function inspectElementRaw(id: number): InspectedElement | null {
    const internalInstance = idToInternalInstanceMap.get(id);
    const data = getData(internalInstance);

    let context = null;
    let owners = null;
    let props = null;
    let state = null;
    let source = null;

    if (internalInstance != null) {
      const element = internalInstance._currentElement;
      if (element !== null) {
        props = element.props;
        source = element._source != null ? element._source : null;

        let owner = element._owner;
        if (owner) {
          owners = [];
          while (owner != null) {
            owners.push({
              displayName: getData(owner).displayName || 'Unknown',
              id: getID(owner),
            });
            owner = owner.owner;
          }
        }
      }
      context = internalInstance.context || null;
      state = internalInstance.state || null;
    }

    return {
      id,

      // Hooks did not exist in legacy versions
      canEditHooks: false,

      // Does the current renderer support editable function props?
      canEditFunctionProps: true,

      // Suspense did not exist in legacy versions
      canToggleSuspense: false,

      // Can view component source location.
      canViewSource:
        data.type === ElementTypeClass || data.type === ElementTypeFunction,

      displayName: data.displayName,

      // New events system did not exist in legacy versions
      events: null,

      // Inspectable properties.
      context,
      hooks: null,
      props,
      state,

      // List of owners
      owners,

      // Location of component in source coude.
      source,
    };
  }

  function logElementToConsole(id: number): void {
    const result = inspectElementRaw(id);
    if (result === null) {
      console.warn(`Could not find element with id "${id}"`);
      return;
    }

    const supportsGroup = typeof console.groupCollapsed === 'function';
    if (supportsGroup) {
      console.groupCollapsed(
        `[Click to expand] %c<${result.displayName || 'Component'} />`,
        // --dom-tag-name-color is the CSS variable Chrome styles HTML elements with in the console.
        'color: var(--dom-tag-name-color); font-weight: normal;'
      );
    }
    if (result.props !== null) {
      console.log('Props:', result.props);
    }
    if (result.state !== null) {
      console.log('State:', result.state);
    }
    if (result.context !== null) {
      console.log('State:', result.context);
    }
    const nativeNode = findNativeNodeForInternalID(id);
    if (nativeNode !== null) {
      console.log('Node:', nativeNode);
    }
    if (window.chrome || /firefox/i.test(navigator.userAgent)) {
      console.log(
        'Right-click any value to save it as a global variable for further inspection.'
      );
    }
    if (supportsGroup) {
      console.groupEnd();
    }
  }

  function prepareViewElementSource(id: number): void {
    const internalInstance = idToInternalInstanceMap.get(id);
    if (internalInstance == null) {
      console.warn(`Could not find instance with id "${id}"`);
      return;
    }

    const element = internalInstance._currentElement;
    if (element == null) {
      console.warn(`Could not find element with id "${id}"`);
      return;
    }

    global.$type = element.type;
  }

  function selectElement(id: number): void {
    const internalInstance = idToInternalInstanceMap.get(id);
    if (internalInstance == null) {
      console.warn(`Could not find instance with id "${id}"`);
      return;
    }

    switch (getElementType(internalInstance)) {
      case ElementTypeClass:
      case ElementTypeFunction:
        const element = internalInstance._currentElement;
        if (element == null) {
          console.warn(`Could not find element with id "${id}"`);
          return;
        }

        global.$r = {
          props: element.props,
          type: element.type,
        };
        break;
      default:
        break;
    }
  }

  function recordPendingMount(internalInstance: InternalInstance) {
    const id = getID(internalInstance);
    pendingMountIDs.add(id);
    idToParentIDMap.set(id, currentParentID);

    if (__DEBUG__) {
      console.log(
        '%crecordPendingMount()',
        'color: green',
        getID(internalInstance)
      );
    }

    queueFlushPendingEvents();
  }

  function recordPendingReorder(internalInstance: InternalInstance) {
    const id = getID(internalInstance);
    pendingReorderIDs.add(id);

    if (__DEBUG__) {
      console.log('%crecordPendingReorder()', 'color: green', id);
    }

    queueFlushPendingEvents();
  }

  function recordPendingUnmount(internalInstance: InternalInstance) {
    const id = getID(internalInstance);

    pendingUnmountIDs.add(id);

    // Not all nodes are mounted (or unmounted) in the frontend DevTools tree,
    // so it's important to remove entries from this map on pending unmount.
    idToParentIDMap.delete(id);

    if (__DEBUG__) {
      console.log(
        '%crecordPendingUnmount()',
        'color: red',
        getID(internalInstance)
      );
    }

    queueFlushPendingEvents();
  }

  function recordMount(id: number, parentID: number) {
    const internalInstance = ((idToInternalInstanceMap.get(
      id
    ): any): InternalInstance);
    const isRoot = rootIDs.has(id);

    if (__DEBUG__) {
      console.log(
        '%crecordMount()',
        'color: green; font-weight: bold;',
        id,
        getData(internalInstance).displayName
      );
    }

    if (isRoot) {
      // TODO Is this right? For all versions?
      const hasOwnerMetadata =
        internalInstance._currentElement != null &&
        internalInstance._currentElement._owner != null;

      pushOperation(TREE_OPERATION_ADD);
      pushOperation(id);
      pushOperation(ElementTypeRoot);
      pushOperation(0); // isProfilingSupported?
      pushOperation(hasOwnerMetadata ? 1 : 0);
    } else {
      const { displayName, key, type } = getData(internalInstance);

      const ownerID =
        internalInstance._currentElement != null &&
        internalInstance._currentElement._owner != null
          ? getID(internalInstance._currentElement._owner)
          : 0;

      let displayNameStringID = getStringID(displayName);
      let keyStringID = getStringID(key);
      pushOperation(TREE_OPERATION_ADD);
      pushOperation(id);
      pushOperation(type);
      pushOperation(parentID);
      pushOperation(ownerID);
      pushOperation(displayNameStringID);
      pushOperation(keyStringID);
    }
  }

  function setInProps(id: number, path: Array<string | number>, value: any) {
    const internalInstance = idToInternalInstanceMap.get(id);
    if (internalInstance != null) {
      const element = internalInstance._currentElement;
      internalInstance._currentElement = {
        ...element,
        props: copyWithSet(element.props, path, value),
      };
      forceUpdate(internalInstance._instance);
    }
  }

  function setInState(id: number, path: Array<string | number>, value: any) {
    const internalInstance = idToInternalInstanceMap.get(id);
    if (internalInstance != null) {
      setIn(internalInstance.state, path, value);
      internalInstance.forceUpdate();
    }
  }

  function setInContext(id: number, path: Array<string | number>, value: any) {
    const internalInstance = idToInternalInstanceMap.get(id);
    if (internalInstance != null) {
      setIn(internalInstance.context, path, value);
      forceUpdate(internalInstance);
    }
  }

  function setIn(obj: Object, path: Array<string | number>, value: any) {
    const last = path.pop();
    const parent = path.reduce(
      // $FlowFixMe
      (reduced, attr) => (reduced ? reduced[attr] : null),
      obj
    );
    if (parent) {
      // $FlowFixMe
      parent[last] = value;
    }
  }

  // v16+ only features
  const getProfilingData = () => {
    throw new Error('getProfilingData not supported by this renderer');
  };
  const handleCommitFiberRoot = () => {
    throw new Error('handleCommitFiberRoot not supported by this renderer');
  };
  const handleCommitFiberUnmount = () => {
    throw new Error('handleCommitFiberUnmount not supported by this renderer');
  };
  const overrideSuspense = () => {
    throw new Error('overrideSuspense not supported by this renderer');
  };
  const setInHook = () => {
    throw new Error('setInHook not supported by this renderer');
  };
  const startProfiling = () => {
    throw new Error('startProfiling not supported by this renderer');
  };
  const stopProfiling = () => {
    throw new Error('stopProfiling not supported by this renderer');
  };

  function getBestMatchForTrackedPath(): PathMatch | null {
    return null; // TODO (legacy)
  }

  function getPathForElement(id: number): Array<PathFrame> | null {
    return null; // TODO (legacy)
  }

  function updateComponentFilters(componentFilters: Array<ComponentFilter>) {
    // TODO (legacy)
  }

  function setTrackedPath(path: Array<PathFrame> | null) {
    // TODO (legacy)
  }

  function getOwnersList(id: number): Array<Owner> | null {
    return null; // TODO (legacy)
  }

  return {
    cleanup,
    flushInitialOperations,
    getBestMatchForTrackedPath,
    getFiberIDForNative: getInternalIDForNative,
    findNativeNodesForFiberID: (id: number) => {
      const nativeNode = findNativeNodeForInternalID(id);
      return nativeNode == null ? null : [nativeNode];
    },
    getOwnersList,
    getPathForElement,
    getProfilingData,
    handleCommitFiberRoot,
    handleCommitFiberUnmount,
    inspectElement,
    logElementToConsole,
    overrideSuspense,
    prepareViewElementSource,
    renderer,
    selectElement,
    setInContext,
    setInHook,
    setInProps,
    setInState,
    setTrackedPath,
    startProfiling,
    stopProfiling,
    updateComponentFilters,
  };
}
