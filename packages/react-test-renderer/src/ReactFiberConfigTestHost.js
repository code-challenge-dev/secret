/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';

import isArray from 'shared/isArray';
import {REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';
import {
  DefaultEventPriority,
  NoEventPriority,
  type EventPriority,
} from 'react-reconciler/src/ReactEventPriorities';

export {default as rendererVersion} from 'shared/ReactVersion'; // TODO: Consider exporting the react-native version.
export const rendererPackageName = 'react-test-renderer';
export const extraDevToolsConfig = null;

export type Type = string;
export type Props = Object;
export type Container = {
  children: Array<Instance | TextInstance>,
  createNodeMock: Function,
  tag: 'CONTAINER',
};
export type Instance = {
  type: string,
  props: Object,
  isHidden: boolean,
  children: Array<Instance | TextInstance>,
  internalInstanceHandle: Object,
  rootContainerInstance: Container,
  tag: 'INSTANCE',
};
export type TextInstance = {
  text: string,
  isHidden: boolean,
  tag: 'TEXT',
};
export type HydratableInstance = Instance | TextInstance;
export type PublicInstance = Instance | TextInstance;
export type HostContext = Object;
export type UpdatePayload = Object;
export type ChildSet = void; // Unused
export type TimeoutHandle = TimeoutID;
export type NoTimeout = -1;
export type EventResponder = any;

export type RendererInspectionConfig = $ReadOnly<{}>;
export type TransitionStatus = mixed;

export * from 'react-reconciler/src/ReactFiberConfigWithNoPersistence';
export * from 'react-reconciler/src/ReactFiberConfigWithNoHydration';
export * from 'react-reconciler/src/ReactFiberConfigWithNoTestSelectors';
export * from 'react-reconciler/src/ReactFiberConfigWithNoMicrotasks';
export * from 'react-reconciler/src/ReactFiberConfigWithNoResources';
export * from 'react-reconciler/src/ReactFiberConfigWithNoSingletons';

const NO_CONTEXT = {};
const nodeToInstanceMap = new WeakMap<any, Instance>();

if (__DEV__) {
  Object.freeze(NO_CONTEXT);
}

export function getPublicInstance(inst: Instance | TextInstance): $FlowFixMe {
  switch (inst.tag) {
    case 'INSTANCE':
      const createNodeMock = inst.rootContainerInstance.createNodeMock;
      const mockNode = createNodeMock({
        type: inst.type,
        props: inst.props,
      });
      if (typeof mockNode === 'object' && mockNode !== null) {
        nodeToInstanceMap.set(mockNode, inst);
      }
      return mockNode;
    default:
      return inst;
  }
}

export function appendChild(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
): void {
  if (__DEV__) {
    if (!isArray(parentInstance.children)) {
      console.error(
        'An invalid container has been provided. ' +
          'This may indicate that another renderer is being used in addition to the test renderer. ' +
          '(For example, ReactDOM.createPortal inside of a ReactTestRenderer tree.) ' +
          'This is not supported.',
      );
    }
  }
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  parentInstance.children.push(child);
}

export function insertBefore(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  const beforeIndex = parentInstance.children.indexOf(beforeChild);
  parentInstance.children.splice(beforeIndex, 0, child);
}

export function removeChild(
  parentInstance: Instance | Container,
  child: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  parentInstance.children.splice(index, 1);
}

export function clearContainer(container: Container): void {
  container.children.splice(0);
}

export function getRootHostContext(
  rootContainerInstance: Container,
): HostContext {
  return NO_CONTEXT;
}

export function getChildHostContext(
  parentHostContext: HostContext,
  type: string,
): HostContext {
  return NO_CONTEXT;
}

export function prepareForCommit(containerInfo: Container): null | Object {
  // noop
  return null;
}

export function resetAfterCommit(containerInfo: Container): void {
  // noop
}

export function createInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: Object,
  internalInstanceHandle: Object,
): Instance {
  return {
    type,
    props,
    isHidden: false,
    children: [],
    internalInstanceHandle,
    rootContainerInstance,
    tag: 'INSTANCE',
  };
}

export function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  parentInstance.children.push(child);
}

export function finalizeInitialChildren(
  testElement: Instance,
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: Object,
): boolean {
  return false;
}

export function shouldSetTextContent(type: string, props: Props): boolean {
  return false;
}

export function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  hostContext: Object,
  internalInstanceHandle: Object,
): TextInstance {
  return {
    text,
    isHidden: false,
    tag: 'TEXT',
  };
}

let currentUpdatePriority: EventPriority = NoEventPriority;
export function setCurrentUpdatePriority(newPriority: EventPriority): void {
  currentUpdatePriority = newPriority;
}

export function getCurrentUpdatePriority(): EventPriority {
  return currentUpdatePriority;
}

export function resolveUpdatePriority(): EventPriority {
  if (currentUpdatePriority !== NoEventPriority) {
    return currentUpdatePriority;
  }
  return DefaultEventPriority;
}
export function resolveEventType(): null | string {
  return null;
}

export function resolveEventTimeStamp(): number {
  return -1.1;
}
export function shouldAttemptEagerTransition(): boolean {
  return false;
}

export const isPrimaryRenderer = false;
export const warnsIfNotActing = true;

export const scheduleTimeout = setTimeout;
export const cancelTimeout = clearTimeout;

export const noTimeout = -1;

// -------------------
//     Mutation
// -------------------

export const supportsMutation = true;

export function commitUpdate(
  instance: Instance,
  type: string,
  oldProps: Props,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  instance.type = type;
  instance.props = newProps;
}

export function commitMount(
  instance: Instance,
  type: string,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  // noop
}

export function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void {
  textInstance.text = newText;
}

export function resetTextContent(testElement: Instance): void {
  // noop
}

export const appendChildToContainer = appendChild;
export const insertInContainerBefore = insertBefore;
export const removeChildFromContainer = removeChild;

export function hideInstance(instance: Instance): void {
  instance.isHidden = true;
}

export function hideTextInstance(textInstance: TextInstance): void {
  textInstance.isHidden = true;
}

export function unhideInstance(instance: Instance, props: Props): void {
  instance.isHidden = false;
}

export function unhideTextInstance(
  textInstance: TextInstance,
  text: string,
): void {
  textInstance.isHidden = false;
}

export function getInstanceFromNode(mockNode: Object): Object | null {
  const instance = nodeToInstanceMap.get(mockNode);
  if (instance !== undefined) {
    return instance.internalInstanceHandle;
  }
  return null;
}

export function beforeActiveInstanceBlur(internalInstanceHandle: Object) {
  // noop
}

export function afterActiveInstanceBlur() {
  // noop
}

export function preparePortalMount(portalInstance: Instance): void {
  // noop
}

export function prepareScopeUpdate(scopeInstance: Object, inst: Object): void {
  nodeToInstanceMap.set(scopeInstance, inst);
}

export function getInstanceFromScope(scopeInstance: Object): null | Object {
  return nodeToInstanceMap.get(scopeInstance) || null;
}

export function detachDeletedInstance(node: Instance): void {
  // noop
}

export function logRecoverableError(error: mixed): void {
  // noop
}

export function requestPostPaintCallback(callback: (time: number) => void) {
  // noop
}

export function maySuspendCommit(type: Type, props: Props): boolean {
  return false;
}

export function preloadInstance(type: Type, props: Props): boolean {
  // Return true to indicate it's already loaded
  return true;
}

export function startSuspendingCommit(): void {}

export function suspendInstance(type: Type, props: Props): void {}

export function waitForCommitToBeReady(): null {
  return null;
}

export const NotPendingTransition: TransitionStatus = null;
export const HostTransitionContext: ReactContext<TransitionStatus> = {
  $$typeof: REACT_CONTEXT_TYPE,
  Provider: (null: any),
  Consumer: (null: any),
  _currentValue: NotPendingTransition,
  _currentValue2: NotPendingTransition,
  _threadCount: 0,
};

export type FormInstance = Instance;
export function resetFormInstance(form: Instance): void {}
