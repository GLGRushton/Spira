import { z } from "zod";

const IdSchema = z.union([z.string().min(1), z.number().int().positive()]).transform((value) => `${value}`);

export const SearchGamesSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
});

export const GetGameSchema = z
  .object({
    id: IdSchema.optional(),
    domainName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.id !== undefined || value.domainName !== undefined, {
    message: "Provide either id or domainName.",
    path: ["id"],
  });

export const SearchModsSchema = z.object({
  gameDomainName: z.string().trim().min(1).max(100),
  query: z.string().trim().max(100).optional(),
  directDownloadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
});

export const GetModFilesSchema = z.object({
  gameId: IdSchema,
  modId: IdSchema,
});

export const DownloadModFileSchema = z.object({
  gameDomainName: z.string().trim().min(1).max(100),
  modId: IdSchema,
  fileId: IdSchema,
  fileUri: z.string().trim().min(1).max(260).optional(),
  fileName: z.string().trim().min(1).max(260).optional(),
  targetDirectory: z.string().trim().min(1).max(1_024).optional(),
});
