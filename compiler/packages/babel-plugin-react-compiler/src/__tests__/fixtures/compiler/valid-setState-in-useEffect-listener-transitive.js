// @validateNoSetStateInPassiveEffects
import {useEffect, useState} from 'react';

function Component() {
  const [state, setState] = useState(0);
  useEffect(() => {
    const f = () => {
      setState();
    };
    setTimeout(() => f(), 10);
  });
  return state;
}

export const FIXTURE_ENTRYPOINT = {
  fn: Component,
  params: [{}],
};
