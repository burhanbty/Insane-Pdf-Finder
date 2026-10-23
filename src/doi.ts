/** DOI'nin kaynaklar arasında ortak kimliği; geçersiz girişle uzak istek yapılmaz. */
export function doiAnahtari(girdi?: string): string | undefined {
  if (typeof girdi !== "string" || girdi.length > 1000) return undefined;
  let s = girdi.trim().replace(/^doi:\s*/i, "");
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (
        !["doi.org", "dx.doi.org"].includes(u.hostname.toLowerCase()) ||
        u.username ||
        u.password ||
        u.port ||
        u.search ||
        u.hash
      )
        return undefined;
      s = decodeURIComponent(u.pathname.slice(1));
    } catch {
      return undefined;
    }
  }
  if (
    s.length > 300 ||
    !/^10\.\d{4,9}\/\S+$/i.test(s) ||
    [...s].some((c) => c.codePointAt(0)! < 33)
  )
    return undefined;
  return s.toLowerCase();
}

export function doiAdresi(girdi?: string): string | undefined {
  const doi = doiAnahtari(girdi);
  return doi ? `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}` : undefined;
}
