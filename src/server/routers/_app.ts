import { router } from "../trpc";
import { codegenRouter } from "./codegen";

export const appRouter = router({
  codegen: codegenRouter,
});

export type AppRouter = typeof appRouter;
