// @validatePreserveExistingMemoizationGuarantees

import { useMemo } from "react";

// False positive as more specific memoization always results
// in fewer memo block executions.
// Precisely:
//  x_new != x_prev does not imply x.y.z_new != x.y.z_prev
//  x.y.z_new != x.y.z_prev does imply x_new != x_prev
function useHook(x) {
  return useMemo(() => [x.y.z], [x]);
}
