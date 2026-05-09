import { createBrowserRouter, redirect } from "react-router";
import Game from "./routes/Game";
import Login from "./routes/Login";
import { eden } from "./eden";
import type { Me } from "./types";

const fetchMe = async (): Promise<Me | null> => {
  const { data, error } = await eden.auth.me.get();
  if (error || !data) return null;
  return data as Me;
};

const gameLoader = async () => {
  const user = await fetchMe();
  if (!user) throw redirect("/login");
  return { user };
};

const loginLoader = async ({ request }: { request: Request }) => {
  const user = await fetchMe();
  if (user) throw redirect("/");
  const url = new URL(request.url);
  return { error: url.searchParams.get("error") };
};

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Game,
    loader: gameLoader,
    shouldRevalidate: () => false,
  },
  {
    path: "/login",
    Component: Login,
    loader: loginLoader,
  },
]);
