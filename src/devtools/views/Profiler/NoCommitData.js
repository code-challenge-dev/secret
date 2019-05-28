// @flow

import React from 'react';
import ToggleCommitFilterModalButton from './ToggleCommitFilterModalButton';

import styles from './NoCommitData.css';

export default function NoCommitData(_: {||}) {
  return (
    <div className={styles.NoCommitData}>
      <div className={styles.Header}>
        There is no data matching the current filter criteria.
      </div>
      <div className={styles.FilterMessage}>
        Try adjusting the commit filter <ToggleCommitFilterModalButton />
      </div>
    </div>
  );
}
