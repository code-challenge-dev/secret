// @flow

import React, {
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
} from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';
import { TreeContext } from './TreeContext';
import { SettingsContext } from './SettingsContext';
import Button from './Button';
import ButtonIcon from './ButtonIcon';
import Element from './Element';
import OwnersStack from './OwnersStack';
import SearchInput from './SearchInput';

import styles from './Tree.css';

type Props = {||};

export default function Tree(props: Props) {
  const {
    baseDepth,
    getElementAtIndex,
    numElements,
    ownerStack,
    selectedElementIndex,
    selectNextElementInTree,
    selectPreviousElementInTree,
  } = useContext(TreeContext);
  const listRef = useRef<FixedSizeList<any>>();

  const { lineHeight } = useContext(SettingsContext);

  // Make sure a newly selected element is visible in the list.
  // This is helpful for things like the owners list.
  useLayoutEffect(() => {
    if (selectedElementIndex !== null && listRef.current != null) {
      listRef.current.scrollToItem(selectedElementIndex);
    }
  }, [listRef, selectedElementIndex]);

  // Navigate the tree with up/down arrow keys.
  useEffect(() => {
    const handleKeyDown = event => {
      // eslint-disable-next-line default-case
      switch (event.key) {
        case 'ArrowDown':
          selectNextElementInTree();
          event.preventDefault();
          break;
        case 'ArrowUp':
          selectPreviousElementInTree();
          event.preventDefault();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    selectedElementIndex,
    selectNextElementInTree,
    selectPreviousElementInTree,
  ]);

  // Let react-window know to re-render any time the underlying tree data changes.
  // This includes the owner context, since it controls a filtered view of the tree.
  const itemData = useMemo(
    () => ({
      baseDepth,
      numElements,
      getElementAtIndex,
    }),
    [baseDepth, numElements, getElementAtIndex]
  );

  return (
    <div className={styles.Tree}>
      <div className={styles.SearchInput}>
        {ownerStack.length > 0 ? <OwnersStack /> : <SearchInput />}
        <Button
          className={styles.IconButton}
          title="Select an element in the page to inspect it"
        >
          <ButtonIcon type="search" />
        </Button>
      </div>
      <div className={styles.AutoSizerWrapper}>
        <AutoSizer>
          {({ height, width }) => (
            <FixedSizeList
              className={styles.List}
              height={height}
              itemCount={numElements}
              itemData={itemData}
              itemSize={lineHeight}
              ref={listRef}
              width={width}
            >
              {Element}
            </FixedSizeList>
          )}
        </AutoSizer>
      </div>
    </div>
  );
}
