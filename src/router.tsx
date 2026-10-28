import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Hash history: the packaged app is loaded from file://, where path-based
// URLs would not resolve on reload.
export const getRouter = () => {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
};
