export { EmptySchema } from "@spira/mcp-util/validation";
import { z } from "zod";

export const CaptureScreenSchema = z.object({
  monitorIndex: z.number().int().min(0).default(0),
});

export const OcrSchema = z.object({
  imagePath: z.string().min(1).max(1_024),
});

export const ReadScreenSchema = z.object({
  target: z.enum(["active-window", "screen"]).default("active-window"),
  monitorIndex: z.number().int().min(0).default(0),
});
