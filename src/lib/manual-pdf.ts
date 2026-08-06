// Gera o Manual de uso em PDF a partir da base de conhecimento (src/lib/manual.ts).
// Usa pdf-lib (JS puro) — sem navegador headless, roda em qualquer container.
import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFPage, type PDFFont } from "pdf-lib";
import { MANUAL, type Block, type ManualSection } from "@/lib/manual";

const A4 = { w: 595.28, h: 841.89 };
const M = { left: 56, right: 56, top: 62, bottom: 64 };
const CONTENT_W = A4.w - M.left - M.right;

const BRAND = rgb(0.059, 0.435, 0.871); // #0F6FDE
const INK = rgb(0.078, 0.125, 0.180);   // #14202E
const SOFT = rgb(0.36, 0.39, 0.44);
const LINE = rgb(0.90, 0.91, 0.93);
const TIP_BG = rgb(0.902, 0.965, 0.933);
const TIP_INK = rgb(0.086, 0.475, 0.298);
const WARN_BG = rgb(1, 0.957, 0.839);
const WARN_INK = rgb(0.604, 0.404, 0.0);

// WinAnsi não cobre emoji nem símbolos fora da Latin-1 — removemos com segurança.
const EXTRA = new Set(["–", "—", "‘", "’", "“", "”", "…", "•", "€", "™", "©", "®"]);
function clean(s: string): string {
  return Array.from(s)
    .filter((ch) => ch.codePointAt(0)! < 256 || EXTRA.has(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = clean(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Marca do Let's Play desenhada vetorialmente (aro + três gomos). */
function drawMark(page: PDFPage, cx: number, cy: number, scale: number) {
  const stroke = 100 * scale * 0.11;
  page.drawCircle({ x: cx, y: cy, size: 100 * scale, borderColor: INK, borderWidth: stroke });

  // curva base em coordenadas SVG (y para baixo), rotacionada 3x
  const pts = [
    [14, -20], [56, -38], [80, -14], [82, 24],
  ];
  for (const deg of [0, 120, 240]) {
    const r = (deg * Math.PI) / 180;
    const p = pts.map(([x, y]) => [
      (x * Math.cos(r) - y * Math.sin(r)) * scale,
      (x * Math.sin(r) + y * Math.cos(r)) * scale,
    ]);
    const d = `M ${p[0][0]} ${p[0][1]} C ${p[1][0]} ${p[1][1]} ${p[2][0]} ${p[2][1]} ${p[3][0]} ${p[3][1]}`;
    page.drawSvgPath(d, {
      x: cx, y: cy,
      borderColor: BRAND,
      borderWidth: stroke,
      borderLineCap: LineCapStyle.Round,
    });
  }
}

class Doc {
  pdf!: PDFDocument;
  regular!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;

  static async create() {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.regular = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.pdf.setTitle("Let's Play — Manual de uso");
    d.pdf.setAuthor("Let's Play");
    d.newPage();
    return d;
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h]);
    this.y = A4.h - M.top;
    return this.page;
  }

  need(h: number) {
    if (this.y - h < M.bottom) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  /** Parágrafo simples. */
  text(t: string, opts: { size?: number; font?: PDFFont; color?: typeof INK; x?: number; width?: number; leading?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.font ?? this.regular;
    const color = opts.color ?? INK;
    const x = opts.x ?? M.left;
    const width = opts.width ?? CONTENT_W;
    const leading = opts.leading ?? size * 1.55;
    for (const line of wrap(t, font, size, width)) {
      this.need(leading);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= leading;
    }
  }
}

function drawBlock(d: Doc, b: Block) {
  switch (b.type) {
    case "p":
      d.text(b.text);
      d.gap(7);
      break;

    case "steps":
      b.items.forEach((t, i) => {
        const size = 10.5, leading = 16;
        const lines = wrap(t, d.regular, size, CONTENT_W - 26);
        d.need(lines.length * leading + 4);
        const top = d.y;
        d.page.drawCircle({ x: M.left + 7, y: top - 7.5, size: 8, color: BRAND });
        const num = String(i + 1);
        d.page.drawText(num, {
          x: M.left + 7 - d.bold.widthOfTextAtSize(num, 8) / 2,
          y: top - 10.4,
          size: 8, font: d.bold, color: rgb(1, 1, 1),
        });
        lines.forEach((line, li) => {
          d.page.drawText(line, { x: M.left + 26, y: top - size - li * leading, size, font: d.regular, color: INK });
        });
        d.y = top - lines.length * leading - 4;
      });
      d.gap(5);
      break;

    case "list":
      b.items.forEach((t) => {
        const size = 10.5, leading = 16;
        const lines = wrap(t, d.regular, size, CONTENT_W - 18);
        d.need(lines.length * leading + 3);
        const top = d.y;
        d.page.drawCircle({ x: M.left + 3.5, y: top - 6, size: 2, color: BRAND });
        lines.forEach((line, li) => {
          d.page.drawText(line, { x: M.left + 18, y: top - size - li * leading, size, font: d.regular, color: INK });
        });
        d.y = top - lines.length * leading - 3;
      });
      d.gap(5);
      break;

    case "fields":
      b.items.forEach((f, i) => {
        const size = 10, leading = 14.5;
        const labelLines = wrap(f.label, d.bold, size, CONTENT_W - 24);
        const textLines = wrap(f.text, d.regular, size, CONTENT_W - 24);
        const h = (labelLines.length + textLines.length) * leading + 14;
        d.need(h);
        const top = d.y;
        d.page.drawRectangle({ x: M.left, y: top - h + 4, width: CONTENT_W, height: h - 4, color: rgb(0.969, 0.973, 0.980) });
        d.page.drawRectangle({ x: M.left, y: top - h + 4, width: 2.5, height: h - 4, color: BRAND });
        let yy = top - 10;
        labelLines.forEach((line) => {
          d.page.drawText(line, { x: M.left + 14, y: yy - size, size, font: d.bold, color: INK });
          yy -= leading;
        });
        textLines.forEach((line) => {
          d.page.drawText(line, { x: M.left + 14, y: yy - size, size, font: d.regular, color: SOFT });
          yy -= leading;
        });
        d.y = top - h - (i === b.items.length - 1 ? 0 : 5);
      });
      d.gap(9);
      break;

    case "tip":
    case "warn": {
      const isTip = b.type === "tip";
      const size = 10, leading = 15, labelSize = 8;
      const ink = isTip ? TIP_INK : WARN_INK;
      const innerW = CONTENT_W - 30;
      const lines = wrap(b.text, d.regular, size, innerW);
      const h = lines.length * leading + labelSize + 22;
      d.need(h + 6);
      const top = d.y;
      d.page.drawRectangle({ x: M.left, y: top - h, width: CONTENT_W, height: h, color: isTip ? TIP_BG : WARN_BG });
      d.page.drawRectangle({ x: M.left, y: top - h, width: 3, height: h, color: ink });
      d.page.drawText(isTip ? "DICA" : "ATENÇÃO", {
        x: M.left + 16, y: top - 12 - labelSize + 2,
        size: labelSize, font: d.bold, color: ink,
      });
      lines.forEach((line, li) => {
        d.page.drawText(line, {
          x: M.left + 16, y: top - 16 - labelSize - li * leading - size + 3,
          size, font: d.regular, color: ink,
        });
      });
      d.y = top - h - 10;
      break;
    }
  }
}

function drawSectionHeading(d: Doc, s: ManualSection, index: number) {
  d.need(74);
  d.gap(6);
  const top = d.y;
  const num = String(index).padStart(2, "0");
  d.page.drawText(num, { x: M.left, y: top - 20, size: 22, font: d.bold, color: rgb(0.87, 0.89, 0.92) });
  d.page.drawText(clean(s.title), { x: M.left + 40, y: top - 18, size: 16, font: d.bold, color: INK });
  d.y = top - 34;
  d.text(s.summary, { size: 10, color: SOFT, x: M.left + 40, width: CONTENT_W - 40 });
  d.gap(6);
  d.page.drawLine({
    start: { x: M.left, y: d.y }, end: { x: A4.w - M.right, y: d.y },
    thickness: 1, color: LINE,
  });
  d.gap(16);
}

export async function buildManualPdf(): Promise<Uint8Array> {
  const d = await Doc.create();

  // ---------- capa ----------
  const cover = d.page;
  cover.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: BRAND });
  drawMark(cover, M.left + 34, A4.h - 190, 0.34);
  cover.drawText("Let's Play", { x: M.left, y: A4.h - 300, size: 42, font: d.bold, color: INK });
  cover.drawText("Manual de uso", { x: M.left, y: A4.h - 336, size: 18, font: d.regular, color: BRAND });
  cover.drawLine({
    start: { x: M.left, y: A4.h - 366 }, end: { x: M.left + 90, y: A4.h - 366 },
    thickness: 2.5, color: BRAND,
  });
  d.y = A4.h - 400;
  d.text(
    "Guia do administrador: turmas, mensalistas, confirmação de presença, pagamentos por Pix e avisos automáticos nos grupos do WhatsApp.",
    { size: 11.5, color: SOFT, width: CONTENT_W - 120, leading: 18 }
  );

  // índice dimensionado para caber inteiro na capa
  const idxLeading = 14.5;
  d.y = M.bottom + MANUAL.length * idxLeading + 52;
  d.page.drawLine({ start: { x: M.left, y: d.y }, end: { x: A4.w - M.right, y: d.y }, thickness: 1, color: LINE });
  d.gap(20);
  d.page.drawText("Conteúdo", { x: M.left, y: d.y - 10, size: 10.5, font: d.bold, color: INK });
  d.gap(20);
  MANUAL.forEach((s, i) => {
    const num = `${String(i + 1).padStart(2, "0")}`;
    d.page.drawText(num, { x: M.left, y: d.y - 9.5, size: 9.5, font: d.bold, color: BRAND });
    d.page.drawText(clean(s.title), { x: M.left + 26, y: d.y - 9.5, size: 9.5, font: d.regular, color: SOFT });
    d.y -= idxLeading;
  });

  // ---------- seções ----------
  d.newPage();
  MANUAL.forEach((s, i) => {
    if (i > 0) d.gap(14);
    drawSectionHeading(d, s, i + 1);
    s.blocks.forEach((b) => drawBlock(d, b));
  });

  // ---------- rodapés ----------
  const pages = d.pdf.getPages();
  pages.forEach((p, i) => {
    if (i === 0) return; // capa sem rodapé
    p.drawLine({
      start: { x: M.left, y: M.bottom - 16 }, end: { x: A4.w - M.right, y: M.bottom - 16 },
      thickness: 0.75, color: LINE,
    });
    p.drawText("Let's Play — Manual de uso", {
      x: M.left, y: M.bottom - 30, size: 8.5, font: d.regular, color: SOFT,
    });
    const label = `${i} / ${pages.length - 1}`;
    p.drawText(label, {
      x: A4.w - M.right - d.regular.widthOfTextAtSize(label, 8.5),
      y: M.bottom - 30, size: 8.5, font: d.regular, color: SOFT,
    });
  });

  return d.pdf.save();
}
