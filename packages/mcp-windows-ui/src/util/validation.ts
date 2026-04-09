import { z } from "zod";

const WindowTargetFields = {
  handle: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  processName: z.string().trim().min(1).max(200).optional(),
};

const NodeSelectorFields = {
  name: z.string().trim().min(1).max(300).optional(),
  automationId: z.string().trim().min(1).max(300).optional(),
  className: z.string().trim().min(1).max(300).optional(),
  controlType: z.string().trim().min(1).max(100).optional(),
};

const WindowTargetBaseSchema = z.object(WindowTargetFields);
const RectangleSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
const TextMatchModeSchema = z.enum(["exact", "contains", "regex"]);

const requireWindowTarget = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (value: { handle?: number; title?: string; processName?: string }) =>
      typeof value.handle === "number" || typeof value.title === "string" || typeof value.processName === "string",
    "Provide at least one window target: handle, title, or processName.",
  );

const requireNodeSelector = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (value: { name?: string; automationId?: string; className?: string; controlType?: string }) =>
      typeof value.name === "string" ||
      typeof value.automationId === "string" ||
      typeof value.className === "string" ||
      typeof value.controlType === "string",
    "Provide at least one selector field: name, automationId, className, or controlType.",
  );

export const EmptySchema = z.object({});

export const WindowTargetSchema = requireWindowTarget(WindowTargetBaseSchema);

export const CaptureWindowSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    preferPrintWindow: z.boolean().default(true),
  }),
);

export const UiReadWindowSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    preferPrintWindow: z.boolean().default(true),
    keepImage: z.boolean().default(false),
  }),
);

export const ActivateWindowSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    restore: z.boolean().default(true),
  }),
);

export const UiTreeSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    path: z.array(z.number().int().min(0)).max(64).optional(),
    maxDepth: z.number().int().min(0).max(8).default(3),
  }),
);

export const UiFindNodesSchema = requireNodeSelector(
  requireWindowTarget(
    WindowTargetBaseSchema.extend(NodeSelectorFields).extend({
      path: z.array(z.number().int().min(0)).max(64).optional(),
      maxDepth: z.number().int().min(0).max(10).default(6),
      limit: z.number().int().min(1).max(250).default(25),
    }),
  ),
);

export const UiActionSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    path: z.array(z.number().int().min(0)).min(1).max(64),
    action: z.enum(["focus", "invoke", "select", "expand", "collapse", "scroll-into-view", "toggle", "set-value"]),
    text: z.string().max(10_000).optional(),
  }),
).superRefine((value, ctx) => {
  if (value.action === "set-value" && typeof value.text !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The set-value action requires text.",
      path: ["text"],
    });
  }
});

export const UiClickWindowPointSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: z.enum(["left", "right"]).default("left"),
    doubleClick: z.boolean().default(false),
    restore: z.boolean().default(true),
  }),
);

export const UiClickTextSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    text: z.string().trim().min(1).max(500),
    match: TextMatchModeSchema.default("contains"),
    occurrence: z.number().int().min(1).max(100).default(1),
    region: RectangleSchema.optional(),
    button: z.enum(["left", "right"]).default("left"),
    doubleClick: z.boolean().default(false),
    restore: z.boolean().default(true),
    preferPrintWindow: z.boolean().default(true),
  }),
);

export const UiSendKeysSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    text: z.string().max(10_000).optional(),
    keys: z.string().max(1_000).optional(),
    restore: z.boolean().default(true),
  }),
).superRefine((value, ctx) => {
  const hasText = typeof value.text === "string";
  const hasKeys = typeof value.keys === "string";
  if (hasText === hasKeys) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of text or keys.",
      path: ["text"],
    });
  }
});

const WaitForWindowTitleConditionSchema = z.object({
  type: z.literal("window-title-contains"),
  text: z.string().trim().min(1).max(300),
});

const WaitForTextVisibleConditionSchema = z.object({
  type: z.literal("text-visible"),
  text: z.string().trim().min(1).max(500),
  match: TextMatchModeSchema.default("contains"),
  preferPrintWindow: z.boolean().default(true),
  region: RectangleSchema.optional(),
});

const WaitForNodeExistsConditionSchema = z.object({
  type: z.literal("node-exists"),
  path: z.array(z.number().int().min(0)).max(64).optional(),
  name: z.string().trim().min(1).max(300).optional(),
  automationId: z.string().trim().min(1).max(300).optional(),
  className: z.string().trim().min(1).max(300).optional(),
  controlType: z.string().trim().min(1).max(100).optional(),
  maxDepth: z.number().int().min(0).max(10).default(6),
});

export const UiWaitForSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend({
    timeoutMs: z.number().int().min(250).max(60_000).default(10_000),
    pollIntervalMs: z.number().int().min(100).max(5_000).default(500),
    stablePolls: z.number().int().min(1).max(10).default(1),
    condition: z.discriminatedUnion("type", [
      WaitForWindowTitleConditionSchema,
      WaitForTextVisibleConditionSchema,
      WaitForNodeExistsConditionSchema,
    ]),
  }),
).superRefine((value, ctx) => {
  if (value.condition.type !== "node-exists") {
    return;
  }

  const hasSelector =
    typeof value.condition.name === "string" ||
    typeof value.condition.automationId === "string" ||
    typeof value.condition.className === "string" ||
    typeof value.condition.controlType === "string";
  if (!hasSelector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The node-exists condition requires at least one selector field.",
      path: ["condition"],
    });
  }
});

export const UiScrapeVirtualListSchema = requireWindowTarget(
  WindowTargetBaseSchema.extend(NodeSelectorFields).extend({
    path: z.array(z.number().int().min(0)).max(64).optional(),
    itemControlType: z.string().trim().min(1).max(100).optional(),
    itemMaxDepth: z.number().int().min(0).max(6).default(1),
    maxIterations: z.number().int().min(1).max(200).default(40),
    maxItems: z.number().int().min(1).max(1_000).default(250),
  }),
).superRefine((value, ctx) => {
  const hasSelector =
    typeof value.path !== "undefined" ||
    typeof value.name === "string" ||
    typeof value.automationId === "string" ||
    typeof value.className === "string" ||
    typeof value.controlType === "string";

  if (!hasSelector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either a node path or a selector to locate the list container.",
      path: ["path"],
    });
  }
});

export const ChromiumPortSchema = z.object({
  host: z.string().trim().min(1).max(255).default("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
});

export const ChromiumAttachSchema = ChromiumPortSchema.extend({
  targetId: z.string().trim().min(1).max(200).optional(),
  titleIncludes: z.string().trim().min(1).max(200).optional(),
  urlIncludes: z.string().trim().min(1).max(500).optional(),
});

export const ChromiumSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const ChromiumSnapshotSchema = ChromiumSessionSchema.extend({
  maxTextLength: z.number().int().min(250).max(20_000).default(4_000),
  maxHtmlLength: z.number().int().min(250).max(20_000).default(4_000),
});

export const ChromiumQuerySchema = ChromiumSessionSchema.extend({
  selector: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(250).default(25),
});

export const ChromiumActionSchema = ChromiumSessionSchema.extend({
  selector: z.string().trim().min(1).max(1_000),
  action: z.enum(["focus", "click", "type"]),
  text: z.string().max(10_000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "type" && typeof value.text !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The type action requires text.",
      path: ["text"],
    });
  }
});
