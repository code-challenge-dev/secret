/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Snapshot, ReactProfilerData} from '../types';
import type {
  Interaction,
  Point,
  Rect,
  Size,
  Surface,
  ViewRefs,
} from '../view-base';

import {positioningScaleFactor, timestampToPosition} from './utils/positioning';
import {
  intersectionOfRects,
  rectContainsPoint,
  rectEqualToRect,
  View,
} from '../view-base';
import {BORDER_SIZE, COLORS, SNAPSHOT_HEIGHT} from './constants';

type OnHover = (node: Snapshot | null) => void;

export class SnapshotsView extends View {
  _intrinsicSize: Size;
  _profilerData: ReactProfilerData;

  onHover: OnHover | null = null;

  constructor(surface: Surface, frame: Rect, profilerData: ReactProfilerData) {
    super(surface, frame);

    this._intrinsicSize = {
      width: profilerData.duration,
      height: SNAPSHOT_HEIGHT,
    };
    this._profilerData = profilerData;
  }

  desiredSize() {
    return this._intrinsicSize;
  }

  draw(context: CanvasRenderingContext2D) {
    const {visibleArea} = this;

    context.fillStyle = COLORS.BACKGROUND;
    context.fillRect(
      visibleArea.origin.x,
      visibleArea.origin.y,
      visibleArea.size.width,
      visibleArea.size.height,
    );

    const y = visibleArea.origin.y;

    let x = visibleArea.origin.x;

    // Rather than drawing each snapshot where it occured,
    // draw them at fixed intervals and just show the nearest one.
    while (x < visibleArea.origin.x + visibleArea.size.width) {
      const snapshot = this._findClosestSnapshot(x);
      if (snapshot === null) {
        // This shold never happen.
        break;
      }

      const scaledHeight = SNAPSHOT_HEIGHT;
      const scaledWidth = (snapshot.width * SNAPSHOT_HEIGHT) / snapshot.height;

      const imageRect: Rect = {
        origin: {
          x,
          y,
        },
        size: {width: scaledWidth, height: scaledHeight},
      };

      // Lazily create and cache Image objects as we render a snapsho for the first time.
      if (snapshot.image === null) {
        const img = (snapshot.image = new Image());
        img.onload = () => {
          this._drawSnapshotImage(context, snapshot, imageRect);
        };
        img.src = snapshot.imageSource;
      } else {
        this._drawSnapshotImage(context, snapshot, imageRect);
      }

      x += scaledWidth + BORDER_SIZE;
    }
  }

  handleInteraction(interaction: Interaction, viewRefs: ViewRefs) {
    switch (interaction.type) {
      case 'mousemove':
      case 'wheel-control':
      case 'wheel-meta':
      case 'wheel-plain':
      case 'wheel-shift':
        this._updateHover(interaction.payload.location, viewRefs);
        break;
    }
  }

  _drawSnapshotImage(
    context: CanvasRenderingContext2D,
    snapshot: Snapshot,
    imageRect: Rect,
  ) {
    const visibleArea = this.visibleArea;

    // Prevent snapshot from visibly overflowing its container when clipped.
    const shouldClip = !rectEqualToRect(imageRect, visibleArea);
    if (shouldClip) {
      const clippedRect = intersectionOfRects(imageRect, visibleArea);
      context.save();
      context.beginPath();
      context.rect(
        clippedRect.origin.x,
        clippedRect.origin.y,
        clippedRect.size.width,
        clippedRect.size.height,
      );
      context.closePath();
      context.clip();
    }

    context.fillStyle = COLORS.REACT_RESIZE_BAR_BORDER;
    context.fillRect(
      imageRect.origin.x,
      imageRect.origin.y,
      imageRect.size.width,
      imageRect.size.height,
    );

    // $FlowFixMe Flow doesn't know about the 9 argument variant of drawImage()
    context.drawImage(
      snapshot.image,

      // Image coordinates
      0,
      0,

      // Native image size
      snapshot.width,
      snapshot.height,

      // Canvas coordinates
      imageRect.origin.x + BORDER_SIZE,
      imageRect.origin.y + BORDER_SIZE,

      // Scaled image size
      imageRect.size.width - BORDER_SIZE * 2,
      imageRect.size.height - BORDER_SIZE * 2,
    );

    if (shouldClip) {
      context.restore();
    }
  }

  _findClosestSnapshot(x: number): Snapshot | null {
    const frame = this.frame;
    const scaleFactor = positioningScaleFactor(
      this._intrinsicSize.width,
      frame,
    );

    const snapshots = this._profilerData.snapshots;

    let startIndex = 0;
    let stopIndex = snapshots.length - 1;
    while (startIndex <= stopIndex) {
      const currentIndex = Math.floor((startIndex + stopIndex) / 2);
      const snapshot = snapshots[currentIndex];
      const {timestamp} = snapshot;

      const snapshotX = Math.floor(
        timestampToPosition(timestamp, scaleFactor, frame),
      );

      if (x < snapshotX) {
        stopIndex = currentIndex - 1;
      } else {
        startIndex = currentIndex + 1;
      }
    }

    return snapshots[stopIndex] || null;
  }

  /**
   * @private
   */
  _updateHover(location: Point, viewRefs: ViewRefs) {
    const {onHover, visibleArea} = this;
    if (!onHover) {
      return;
    }

    if (!rectContainsPoint(location, visibleArea)) {
      onHover(null);
      return;
    }

    const snapshot = this._findClosestSnapshot(location.x);
    if (snapshot !== null) {
      onHover(snapshot);
    } else {
      onHover(null);
    }
  }
}
