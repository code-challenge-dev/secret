// @compilationMode(infer)
import { useIdentity, identity } from "shared-runtime";

function Component(fakeProps: number) {
  const x = useIdentity(fakeProps);
  return identity(x);
}

export const FIXTURE_ENTRYPOINT = {
  fn: Component,
  params: [42],
};
