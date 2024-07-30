/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as React from 'react';
import {useCallback, useContext, useSyncExternalStore} from 'react';
import {TreeDispatcherContext, TreeStateContext} from './TreeContext';
import {BridgeContext, StoreContext, OptionsContext} from '../context';
import Button from '../Button';
import ButtonIcon from '../ButtonIcon';
import Icon from '../Icon';
import {ModalDialogContext} from '../ModalDialog';
import Toggle from '../Toggle';
import {ElementTypeSuspense} from 'react-devtools-shared/src/frontend/types';
import CannotSuspendWarningMessage from './CannotSuspendWarningMessage';
import InspectedElementView from './InspectedElementView';
import {InspectedElementContext} from './InspectedElementContext';
import {getOpenInEditorURL} from '../../../utils';
import {LOCAL_STORAGE_OPEN_IN_EDITOR_URL} from '../../../constants';
import FetchFileWithCachingContext from './FetchFileWithCachingContext';
import {symbolicateSourceWithCache} from 'react-devtools-shared/src/symbolicateSource';
import OpenInEditorButton from './OpenInEditorButton';
import InspectedElementViewSourceButton from './InspectedElementViewSourceButton';
import Skeleton from './Skeleton';

import styles from './InspectedElement.css';

import type {Source} from 'react-devtools-shared/src/shared/types';

export type Props = {};

// TODO Make edits and deletes also use transition API!

export default function InspectedElementWrapper(_: Props): React.Node {
  const {inspectedElementID} = useContext(TreeStateContext);
  const dispatch = useContext(TreeDispatcherContext);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);
  const {
    hideToggleErrorAction,
    hideToggleSuspenseAction,
    hideLogAction,
    hideViewSourceAction,
  } = useContext(OptionsContext);
  const {dispatch: modalDialogDispatch} = useContext(ModalDialogContext);

  const {hookNames, inspectedElement, parseHookNames, toggleParseHookNames} =
    useContext(InspectedElementContext);

  const fetchFileWithCaching = useContext(FetchFileWithCachingContext);

  const symbolicatedSourcePromise: null | Promise<Source | null> =
    React.useMemo(() => {
      if (inspectedElement == null) return null;
      if (fetchFileWithCaching == null) return Promise.resolve(null);

      const {source} = inspectedElement;
      if (source == null) return Promise.resolve(null);

      const {sourceURL, line, column} = source;
      return symbolicateSourceWithCache(
        fetchFileWithCaching,
        sourceURL,
        line,
        column,
      );
    }, [inspectedElement]);

  const element =
    inspectedElementID !== null
      ? store.getElementByID(inspectedElementID)
      : null;

  const highlightElement = useCallback(() => {
    if (element !== null && inspectedElementID !== null) {
      const rendererID = store.getRendererIDForElement(inspectedElementID);
      if (rendererID !== null) {
        bridge.send('highlightHostInstance', {
          displayName: element.displayName,
          hideAfterTimeout: true,
          id: inspectedElementID,
          openBuiltinElementsPanel: true,
          rendererID,
          scrollIntoView: true,
        });
      }
    }
  }, [bridge, element, inspectedElementID, store]);

  const logElement = useCallback(() => {
    if (inspectedElementID !== null) {
      const rendererID = store.getRendererIDForElement(inspectedElementID);
      if (rendererID !== null) {
        bridge.send('logElementToConsole', {
          id: inspectedElementID,
          rendererID,
        });
      }
    }
  }, [bridge, inspectedElementID, store]);

  const isErrored = inspectedElement != null && inspectedElement.isErrored;
  const targetErrorBoundaryID =
    inspectedElement != null ? inspectedElement.targetErrorBoundaryID : null;

  const isSuspended =
    element !== null &&
    element.type === ElementTypeSuspense &&
    inspectedElement != null &&
    inspectedElement.state != null;

  const canToggleError =
    !hideToggleErrorAction &&
    inspectedElement != null &&
    inspectedElement.canToggleError;

  const canToggleSuspense =
    !hideToggleSuspenseAction &&
    inspectedElement != null &&
    inspectedElement.canToggleSuspense;

  const editorURL = useSyncExternalStore(
    function subscribe(callback) {
      window.addEventListener(LOCAL_STORAGE_OPEN_IN_EDITOR_URL, callback);
      return function unsubscribe() {
        window.removeEventListener(LOCAL_STORAGE_OPEN_IN_EDITOR_URL, callback);
      };
    },
    function getState() {
      return getOpenInEditorURL();
    },
  );

  const toggleErrored = useCallback(() => {
    if (inspectedElement == null || targetErrorBoundaryID == null) {
      return;
    }

    const rendererID = store.getRendererIDForElement(targetErrorBoundaryID);
    if (rendererID !== null) {
      if (targetErrorBoundaryID !== inspectedElement.id) {
        // Update tree selection so that if we cause a component to error,
        // the nearest error boundary will become the newly selected thing.
        dispatch({
          type: 'SELECT_ELEMENT_BY_ID',
          payload: targetErrorBoundaryID,
        });
      }

      // Toggle error.
      bridge.send('overrideError', {
        id: targetErrorBoundaryID,
        rendererID,
        forceError: !isErrored,
      });
    }
  }, [bridge, dispatch, isErrored, targetErrorBoundaryID]);

  // TODO (suspense toggle) Would be nice to eventually use a two setState pattern here as well.
  const toggleSuspended = useCallback(() => {
    let nearestSuspenseElement = null;
    let currentElement = element;
    while (currentElement !== null) {
      if (currentElement.type === ElementTypeSuspense) {
        nearestSuspenseElement = currentElement;
        break;
      } else if (currentElement.parentID > 0) {
        currentElement = store.getElementByID(currentElement.parentID);
      } else {
        currentElement = null;
      }
    }

    // If we didn't find a Suspense ancestor, we can't suspend.
    // Instead we can show a warning to the user.
    if (nearestSuspenseElement === null) {
      modalDialogDispatch({
        id: 'InspectedElement',
        type: 'SHOW',
        content: <CannotSuspendWarningMessage />,
      });
    } else {
      const nearestSuspenseElementID = nearestSuspenseElement.id;

      // If we're suspending from an arbitrary (non-Suspense) component, select the nearest Suspense element in the Tree.
      // This way when the fallback UI is shown and the current element is hidden, something meaningful is selected.
      if (nearestSuspenseElement !== element) {
        dispatch({
          type: 'SELECT_ELEMENT_BY_ID',
          payload: nearestSuspenseElementID,
        });
      }

      const rendererID = store.getRendererIDForElement(
        nearestSuspenseElementID,
      );

      // Toggle suspended
      if (rendererID !== null) {
        bridge.send('overrideSuspense', {
          id: nearestSuspenseElementID,
          rendererID,
          forceFallback: !isSuspended,
        });
      }
    }
  }, [bridge, dispatch, element, isSuspended, modalDialogDispatch, store]);

  if (element === null) {
    return (
      <div className={styles.InspectedElement}>
        <div className={styles.TitleRow} />
      </div>
    );
  }

  let strictModeBadge = null;
  if (element.isStrictModeNonCompliant) {
    strictModeBadge = (
      <a
        className={styles.StrictModeNonCompliant}
        href="https://react.dev/reference/react/StrictMode"
        rel="noopener noreferrer"
        target="_blank"
        title="This component is not running in StrictMode. Click to learn more.">
        <Icon type="strict-mode-non-compliant" />
      </a>
    );
  }

  return (
    <div className={styles.InspectedElement}>
      <div className={styles.TitleRow} data-testname="InspectedElement-Title">
        {strictModeBadge}

        {element.key && (
          <>
            <div className={styles.Key} title={`key "${element.key}"`}>
              {element.key}
            </div>
            <div className={styles.KeyArrow} />
          </>
        )}

        <div className={styles.SelectedComponentName}>
          <div
            className={
              element.isStrictModeNonCompliant
                ? `${styles.ComponentName} ${styles.StrictModeNonCompliantComponentName}`
                : styles.ComponentName
            }
            title={element.displayName}>
            {element.displayName}
          </div>
        </div>

        {!!editorURL &&
          inspectedElement != null &&
          inspectedElement.source != null &&
          symbolicatedSourcePromise != null && (
            <React.Suspense fallback={<Skeleton height={16} width={24} />}>
              <OpenInEditorButton
                editorURL={editorURL}
                source={inspectedElement.source}
                symbolicatedSourcePromise={symbolicatedSourcePromise}
              />
            </React.Suspense>
          )}

        {canToggleError && (
          <Toggle
            isChecked={isErrored}
            onChange={toggleErrored}
            title={
              isErrored
                ? 'Clear the forced error'
                : 'Force the selected component into an errored state'
            }>
            <ButtonIcon type="error" />
          </Toggle>
        )}
        {canToggleSuspense && (
          <Toggle
            isChecked={isSuspended}
            onChange={toggleSuspended}
            title={
              isSuspended
                ? 'Unsuspend the selected component'
                : 'Suspend the selected component'
            }>
            <ButtonIcon type="suspend" />
          </Toggle>
        )}
        {store.supportsInspectMatchingDOMElement && (
          <Button
            onClick={highlightElement}
            title="Inspect the matching DOM element">
            <ButtonIcon type="view-dom" />
          </Button>
        )}
        {!hideLogAction && (
          <Button
            onClick={logElement}
            title="Log this component data to the console">
            <ButtonIcon type="log-data" />
          </Button>
        )}

        {!hideViewSourceAction && (
          <InspectedElementViewSourceButton
            canViewSource={inspectedElement?.canViewSource}
            source={inspectedElement?.source}
            symbolicatedSourcePromise={symbolicatedSourcePromise}
          />
        )}
      </div>

      {inspectedElement === null && (
        <div className={styles.Loading}>Loading...</div>
      )}

      {inspectedElement !== null && symbolicatedSourcePromise != null && (
        <InspectedElementView
          key={
            inspectedElementID /* Force reset when selected Element changes */
          }
          element={element}
          hookNames={hookNames}
          inspectedElement={inspectedElement}
          parseHookNames={parseHookNames}
          toggleParseHookNames={toggleParseHookNames}
          symbolicatedSourcePromise={symbolicatedSourcePromise}
        />
      )}
    </div>
  );
}
