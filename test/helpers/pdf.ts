/** Küçük ama gerçekten açılabilir PDF; kimlik/aktarım testleri gerçek parser'ı kullanır. */
export function testPdf(baslik: string, metin: string): Uint8Array<ArrayBuffer> {
  const kacis = (s: string) => s.replace(/([\\()])/g, "\\$1");
  const icerik = `BT /F1 12 Tf 40 750 Td (${kacis(metin)}) Tj ET`;
  const nesneler = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(icerik)} >>\nstream\n${icerik}\nendstream`,
    `<< /Title (${kacis(baslik)}) >>`,
  ];
  let veri = "%PDF-1.4\n";
  const offsetler = [0];
  for (let i = 0; i < nesneler.length; i++) {
    offsetler.push(Buffer.byteLength(veri));
    veri += `${i + 1} 0 obj\n${nesneler[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(veri);
  veri += `xref\n0 7\n0000000000 65535 f \n${offsetler
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(veri));
}
