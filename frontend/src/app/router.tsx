import { createBrowserRouter, type RouteObject } from "react-router";
import { GuestOnly } from "../auth/GuestOnly";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { LOGIN_PATH } from "../auth/guards";
import { RequireRole } from "../rbac/RequireRole";
import { AppLayout } from "./layouts/AppLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { featureRoutes } from "./routes";

/**
 * Route tree:
 *
 *   GuestOnly → AuthLayout → /login
 *   RequireAuth → AppLayout
 *     /                  home (any signed-in role)
 *     RequireRole(roles) → each featureRoutes entry
 *     *                  not found
 */
export const routes: RouteObject[] = [
  {
    element: <GuestOnly />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: LOGIN_PATH, element: <LoginPage /> }],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          ...featureRoutes.map(
            (route): RouteObject => ({
              element: <RequireRole roles={route.roles} />,
              children: [{ path: route.path, element: route.element }],
            })
          ),
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
