import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { describeSqlServerError, executeSqlQuery } from "./connection.js";

describe("describeSqlServerError", () => {
  it("maps login failures to a clear credential error", () => {
    expect(describeSqlServerError(new Error("Login failed for user 'readonly'."))).toContain("login failed");
  });

  it("maps timeouts to the read-only timeout message", () => {
    expect(describeSqlServerError(new Error("Timeout: Request failed"))).toContain("timed out");
  });
});

describe("executeSqlQuery", () => {
  it("streams rows and cancels once the configured cap is exceeded", async () => {
    class FakeRequest extends EventEmitter {
      public stream = false;
      public canceled = false;

      cancel(): void {
        this.canceled = true;
      }

      query(_sqlText: string, callback: (error?: Error) => void): void {
        const recordset = [] as Array<Record<string, unknown>> & { columns?: Record<string, unknown> };
        recordset.columns = { id: {}, name: {} };
        this.emit("recordset", recordset);
        this.emit("row", { id: 1, name: "one" });
        this.emit("row", { id: 2, name: "two" });
        this.emit("row", { id: 3, name: "three" });
        callback(new Error("Canceled."));
      }
    }

    const request = new FakeRequest();
    const pool = {
      request: () => request,
    };

    await expect(
      executeSqlQuery(pool as never, "SELECT * FROM dbo.Users", {
        server: "localhost",
        username: "readonly",
        password: "secret",
        encrypt: true,
        trustServerCertificate: false,
        allowedDatabases: [],
        rowLimit: 2,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({
      columns: ["id", "name"],
      rows: [
        { id: 1, name: "one" },
        { id: 2, name: "two" },
      ],
      totalRowCount: 3,
      truncated: true,
      rowLimit: 2,
      timeoutMs: 1000,
    });
    expect(request.stream).toBe(true);
    expect(request.canceled).toBe(true);
  });
});
