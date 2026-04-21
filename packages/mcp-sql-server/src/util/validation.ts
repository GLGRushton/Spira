import { z } from "zod";

const DatabaseNameSchema = z.string().trim().min(1).max(128);
const SchemaNameSchema = z.string().trim().min(1).max(128);
const TableNameSchema = z.string().trim().min(1).max(128);

export const DatabaseScopeSchema = z.object({
  database: DatabaseNameSchema,
});

export const ListTablesSchema = DatabaseScopeSchema.extend({
  schema: SchemaNameSchema.optional(),
});

export const DescribeTableSchema = DatabaseScopeSchema.extend({
  schema: SchemaNameSchema,
  table: TableNameSchema,
});

export const QuerySchema = DatabaseScopeSchema.extend({
  sql: z.string().trim().min(1).max(50_000),
});
