import type { ProviderToolDefinition, ProviderToolResultObject } from "../provider/types.js";
import type { YouTrackAttachmentContent, YouTrackAttachmentMetadata, YouTrackService } from "../youtrack/service.js";

export const YOUTRACK_INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const YOUTRACK_INLINE_TEXT_MAX_BYTES = 256 * 1024;

const INLINE_TEXT_MIME_PREFIXES = ["text/"] as const;
const INLINE_TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/x-sh",
  "application/x-shellscript",
  "application/sql",
]);

const isImageMime = (mimeType: string): boolean => mimeType.toLowerCase().startsWith("image/");
const isVideoMime = (mimeType: string): boolean => mimeType.toLowerCase().startsWith("video/");
const isInlineableTextMime = (mimeType: string): boolean => {
  const lowered = mimeType.toLowerCase();
  if (INLINE_TEXT_MIME_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  return INLINE_TEXT_MIME_EXACT.has(lowered);
};

const formatMetadata = (metadata: YouTrackAttachmentMetadata): Record<string, unknown> => ({
  id: metadata.id,
  name: metadata.name,
  mimeType: metadata.mimeType,
  size: metadata.size,
  createdAt: metadata.createdAt,
  author: metadata.author,
});

const toSuccessText = (value: unknown): ProviderToolResultObject => ({
  resultType: "success",
  textResultForLlm: typeof value === "string" ? value : JSON.stringify(value, null, 2),
});

const toFailure = (message: string): ProviderToolResultObject => ({
  resultType: "failure",
  error: message,
  textResultForLlm: message,
});

const getString = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
};

const renderInlineText = (attachment: YouTrackAttachmentContent): ProviderToolResultObject => {
  if (attachment.size > YOUTRACK_INLINE_TEXT_MAX_BYTES) {
    return toSuccessText({
      metadata: formatMetadata(attachment),
      message: `Text attachment is too large to inline (${attachment.size} bytes > ${YOUTRACK_INLINE_TEXT_MAX_BYTES}).`,
    });
  }
  const decoded = attachment.bytes.toString("utf8");
  return toSuccessText({
    metadata: formatMetadata(attachment),
    content: decoded,
  });
};

const renderImageBlock = (attachment: YouTrackAttachmentContent): ProviderToolResultObject => {
  if (attachment.size > YOUTRACK_INLINE_IMAGE_MAX_BYTES) {
    return toSuccessText({
      metadata: formatMetadata(attachment),
      message: `Image attachment is too large to inline (${attachment.size} bytes > ${YOUTRACK_INLINE_IMAGE_MAX_BYTES}). The model cannot view it.`,
    });
  }
  const caption =
    `Attachment ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes) ` +
    `from ticket attachment ${attachment.id}.`;
  return {
    resultType: "success",
    textResultForLlm: caption,
    content: [
      { type: "text", text: caption },
      { type: "image", mimeType: attachment.mimeType, base64: attachment.bytes.toString("base64") },
    ],
  };
};

export const createYouTrackAttachmentTools = (
  youTrackService: Pick<YouTrackService, "isConfigured" | "listAttachments" | "fetchAttachment">,
): ProviderToolDefinition[] => {
  if (!youTrackService.isConfigured()) {
    return [];
  }
  return [
    {
      name: "youtrack_list_attachments",
      description:
        "List all files attached to a YouTrack ticket. Returns metadata only (id, name, mimeType, size, createdAt, author). Use youtrack_view_attachment to fetch the content of an individual attachment.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: {
            type: "string",
            description: "The human-readable YouTrack ticket id, e.g. PROJ-123.",
          },
        },
        required: ["ticket_id"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        const ticketId = getString(args.ticket_id);
        if (!ticketId) {
          return toFailure("youtrack_list_attachments requires a non-empty ticket_id.");
        }
        try {
          const attachments = await youTrackService.listAttachments(ticketId);
          return toSuccessText({
            ticketId,
            attachments: attachments.map((attachment) => formatMetadata(attachment)),
          });
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to list YouTrack attachments.");
        }
      },
    },
    {
      name: "youtrack_view_attachment",
      description:
        "Fetch and view the contents of a single YouTrack attachment. Images are returned inline as multimodal content (up to 5 MB). Small text-like attachments are returned as decoded text. Videos and other binary formats are not supported — only metadata is returned.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: {
            type: "string",
            description: "The human-readable YouTrack ticket id, e.g. PROJ-123.",
          },
          attachment_id: {
            type: "string",
            description:
              "The attachment id, obtained from youtrack_list_attachments. Looks like a short alphanumeric identifier (often prefixed).",
          },
        },
        required: ["ticket_id", "attachment_id"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async (args) => {
        const ticketId = getString(args.ticket_id);
        const attachmentId = getString(args.attachment_id);
        if (!ticketId || !attachmentId) {
          return toFailure("youtrack_view_attachment requires non-empty ticket_id and attachment_id.");
        }
        try {
          const attachment = await youTrackService.fetchAttachment(ticketId, attachmentId);
          if (isImageMime(attachment.mimeType)) {
            return renderImageBlock(attachment);
          }
          if (isVideoMime(attachment.mimeType)) {
            return toSuccessText({
              metadata: formatMetadata(attachment),
              message: "Video attachments are not supported. Only metadata is returned.",
            });
          }
          if (isInlineableTextMime(attachment.mimeType)) {
            return renderInlineText(attachment);
          }
          return toSuccessText({
            metadata: formatMetadata(attachment),
            message: `Attachment type ${attachment.mimeType} is not supported for viewing. Only metadata is returned.`,
          });
        } catch (error) {
          return toFailure(error instanceof Error ? error.message : "Failed to view YouTrack attachment.");
        }
      },
    },
  ];
};
