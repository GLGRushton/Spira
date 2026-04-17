import * as tls from "node:tls";

let systemCertificatesInstalled = false;

const mergeCertificates = (...certificateLists: readonly string[][]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const certificateList of certificateLists) {
    for (const certificate of certificateList) {
      if (!seen.has(certificate)) {
        seen.add(certificate);
        merged.push(certificate);
      }
    }
  }

  return merged;
};

export const installSystemCertificateAuthorities = (): void => {
  if (systemCertificatesInstalled) {
    return;
  }

  const defaultCertificates = tls.getCACertificates("default");
  const mergedCertificates = mergeCertificates(defaultCertificates, tls.getCACertificates("system"));
  if (mergedCertificates.length > defaultCertificates.length) {
    tls.setDefaultCACertificates(mergedCertificates);
  }

  systemCertificatesInstalled = true;
};
