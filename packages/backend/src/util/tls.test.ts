import { afterEach, describe, expect, it, vi } from "vitest";

describe("installSystemCertificateAuthorities", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock("node:tls");
  });

  it("merges system certificates into the default CA bundle once", async () => {
    const getCACertificates = vi.fn((scope: "default" | "system") =>
      scope === "default" ? ["default-cert", "shared-cert"] : ["shared-cert", "system-cert"],
    );
    const setDefaultCACertificates = vi.fn();

    vi.doMock("node:tls", () => ({
      getCACertificates,
      setDefaultCACertificates,
    }));

    const { installSystemCertificateAuthorities } = await import("./tls.js");
    installSystemCertificateAuthorities();
    installSystemCertificateAuthorities();

    expect(getCACertificates).toHaveBeenCalledTimes(2);
    expect(getCACertificates).toHaveBeenNthCalledWith(1, "default");
    expect(getCACertificates).toHaveBeenNthCalledWith(2, "system");
    expect(setDefaultCACertificates).toHaveBeenCalledTimes(1);
    expect(setDefaultCACertificates).toHaveBeenCalledWith(["default-cert", "shared-cert", "system-cert"]);
  });

  it("skips resetting the default CA bundle when the system store adds nothing new", async () => {
    const getCACertificates = vi.fn(() => ["default-cert", "shared-cert"]);
    const setDefaultCACertificates = vi.fn();

    vi.doMock("node:tls", () => ({
      getCACertificates,
      setDefaultCACertificates,
    }));

    const { installSystemCertificateAuthorities } = await import("./tls.js");
    installSystemCertificateAuthorities();

    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });
});
