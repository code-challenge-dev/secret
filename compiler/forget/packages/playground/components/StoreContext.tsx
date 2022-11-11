/*
 * Copyright (c) Facebook, Inc. and its affiliates.
 */

import type { Dispatch, ReactNode } from "react";
import { useReducer } from "react";
import createContext from "../lib/createContext";
import { emptyStore } from "../lib/defaultStore";
import type { Store } from "../lib/stores";
import { saveStore } from "../lib/stores";
import { ForgetCompilerFlags } from "../lib/compilerDriver";

const StoreContext = createContext<Store>();

/**
 * Hook to access the store.
 */
export const useStore = StoreContext.useContext;

const StoreDispatchContext = createContext<Dispatch<ReducerAction>>();

/**
 * Hook to access the store dispatch function.
 */
export const useStoreDispatch = StoreDispatchContext.useContext;

/**
 * Make Store and dispatch function available to all sub-components in children.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, dispatch] = useReducer(storeReducer, emptyStore);

  return (
    <StoreContext.Provider value={store}>
      <StoreDispatchContext.Provider value={dispatch}>
        {children}
      </StoreDispatchContext.Provider>
    </StoreContext.Provider>
  );
}

type ReducerAction =
  | {
      type: "setStore";
      payload: {
        store: Store;
      };
    }
  | {
      type: "updateFile";
      payload: {
        source: string;
      };
    }
  | {
      type: "setCompilerFlag";
      payload: { flag: keyof ForgetCompilerFlags; value: boolean };
    };

function storeReducer(store: Store, action: ReducerAction): Store {
  switch (action.type) {
    case "setStore": {
      const newStore = action.payload.store;

      saveStore(newStore);
      return newStore;
    }
    case "updateFile": {
      const { source } = action.payload;

      const newStore = {
        ...store,
        source,
      };

      saveStore(newStore);
      return newStore;
    }
    case "setCompilerFlag": {
      const { flag, value } = action.payload;

      const newStore = {
        ...store,
        compilerFlags: { ...store.compilerFlags },
      };
      newStore.compilerFlags[flag] = value;
      saveStore(newStore);
      return newStore;
    }
  }
}
