/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint-disable import/first */

import * as React from 'react';
import {block} from 'react';

// Server

import {fetch} from 'react-data/fetch';
import PostList from './PostList';

function load(userId) {
  const postsByUser = fetch(`/posts?userId=${userId}`).json();
  return {
    posts: <PostList posts={postsByUser} />,
  };
}

// Client

function ProfileTimeline(props, data) {
  return (
    <>
      <h3>Timeline</h3>
      {data.posts}
    </>
  );
}

export default block(ProfileTimeline, load);
