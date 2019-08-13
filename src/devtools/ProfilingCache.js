// @flow

import ProfilerStore from './ProfilerStore';
import {
  getCommitTree,
  invalidateCommitTrees,
} from 'src/devtools/views/Profiler/CommitTreeBuilder';
import {
  getChartData as getFlamegraphChartData,
  invalidateChartData as invalidateFlamegraphChartData,
} from 'src/devtools/views/Profiler/FlamegraphChartBuilder';
import {
  getChartData as getInteractionsChartData,
  invalidateChartData as invalidateInteractionsChartData,
} from 'src/devtools/views/Profiler/InteractionsChartBuilder';
import {
  getChartData as getRankedChartData,
  invalidateChartData as invalidateRankedChartData,
} from 'src/devtools/views/Profiler/RankedChartBuilder';

import type { CommitTree } from 'src/devtools/views/Profiler/types';
import type { ChartData as FlamegraphChartData } from 'src/devtools/views/Profiler/FlamegraphChartBuilder';
import type { ChartData as InteractionsChartData } from 'src/devtools/views/Profiler/InteractionsChartBuilder';
import type { ChartData as RankedChartData } from 'src/devtools/views/Profiler/RankedChartBuilder';

export default class ProfilingCache {
  _fiberCommits: Map<number, Array<number>> = new Map();
  _profilerStore: ProfilerStore;

  constructor(profilerStore: ProfilerStore) {
    this._profilerStore = profilerStore;
  }

  getCommitTree = ({
    commitIndex,
    rootID,
  }: {|
    commitIndex: number,
    rootID: number,
  |}) =>
    getCommitTree({
      commitIndex,
      profilerStore: this._profilerStore,
      rootID,
    });

  getFiberCommits = ({
    fiberID,
    rootID,
  }: {|
    fiberID: number,
    rootID: number,
  |}): Array<number> => {
    const cachedFiberCommits = this._fiberCommits.get(fiberID);
    if (cachedFiberCommits != null) {
      return cachedFiberCommits;
    }

    const fiberCommits = [];
    const dataForRoot = this._profilerStore.getDataForRoot(rootID);
    dataForRoot.commitData.forEach((commitDatum, commitIndex) => {
      if (commitDatum.fiberActualDurations.has(fiberID)) {
        fiberCommits.push(commitIndex);
      }
    });

    this._fiberCommits.set(fiberID, fiberCommits);

    return fiberCommits;
  };

  getFlamegraphChartData = ({
    commitIndex,
    commitTree,
    rootID,
  }: {|
    commitIndex: number,
    commitTree: CommitTree,
    rootID: number,
  |}): FlamegraphChartData =>
    getFlamegraphChartData({
      commitIndex,
      commitTree,
      profilerStore: this._profilerStore,
      rootID,
    });

  getInteractionsChartData = ({
    rootID,
  }: {|
    rootID: number,
  |}): InteractionsChartData =>
    getInteractionsChartData({
      profilerStore: this._profilerStore,
      rootID,
    });

  getRankedChartData = ({
    commitIndex,
    commitTree,
    rootID,
  }: {|
    commitIndex: number,
    commitTree: CommitTree,
    rootID: number,
  |}): RankedChartData =>
    getRankedChartData({
      commitIndex,
      commitTree,
      profilerStore: this._profilerStore,
      rootID,
    });

  invalidate() {
    this._fiberCommits.clear();

    invalidateCommitTrees();
    invalidateFlamegraphChartData();
    invalidateInteractionsChartData();
    invalidateRankedChartData();
  }
}
