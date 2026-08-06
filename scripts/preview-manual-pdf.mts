// Gera o manual em PDF e exporta as páginas em PNG para conferência visual.
// Uso: npx tsx scripts/preview-manual-pdf.mts <pasta-de-saida>
import { writeFileSync } from "fs";
import { buildManualPdf } from "../src/lib/manual-pdf";

const out = process.argv[2] ?? ".";
const bytes = await buildManualPdf();
writeFileSync(`${out}/manual.pdf`, Buffer.from(bytes));
console.log(`PDF gerado: ${out}/manual.pdf (${(bytes.length / 1024).toFixed(0)} KB)`);
