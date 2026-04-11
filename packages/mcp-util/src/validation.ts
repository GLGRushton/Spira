import { z } from "zod";

export const ExampleEchoSchema = z.object({
  message: z.string().min(1).max(500),
});

export const EmptySchema = z.object({});
