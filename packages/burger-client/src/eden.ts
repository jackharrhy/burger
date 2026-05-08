import { treaty } from "@elysiajs/eden";
import type { App } from "burger-server";

export const eden = treaty<App>(window.location.origin);
