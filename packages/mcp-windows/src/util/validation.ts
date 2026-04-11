export { EmptySchema } from "@spira/mcp-util/validation";
import { z } from "zod";

export const SetVolumeSchema = z.object({
  level: z.number().int().min(0).max(100),
});

export const SetBrightnessSchema = z.object({
  level: z.number().int().min(0).max(100),
});

export const LaunchAppSchema = z.object({
  name: z.string().min(1).max(200),
});

export const CloseAppSchema = z.object({
  name: z.string().min(1).max(200),
});

export const SendNotificationSchema = z.object({
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
});
