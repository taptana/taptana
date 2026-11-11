/**
 * La presentación como PowerPoint (.pptx), armada en el navegador con pptxgenjs (MIT, JavaScript
 * puro). Dibuja las mismas figuras que la vista en pantalla (`layoutSlide`): texto y formas de
 * verdad, editables en PowerPoint, Keynote o Google Slides, no fotos de las diapositivas.
 *
 * El mapa de calor no va como imagen: su fondo es una reconstrucción de rrweb dentro de un iframe
 * y pasarla a imagen pediría una dependencia pesada y frágil. En su lugar va un recuadro con el
 * nombre de la pantalla; los números y lo más tocado sin efecto ya están al lado.
 *
 * pptxgenjs se carga con `import()` solo al descargar: no pesa en el resto del panel.
 */

import { visibleSlides, type Deck, type StudyReport } from '@taptana/shared';
import { heatmapViewport, layoutSlide, type Shape } from './layout.ts';
import { MUTED, PPTX_FONT, SOFT } from './theme.ts';

/** px de la diapositiva (1280×720) → pulgadas (13,333×7,5). */
const inch = (px: number): number => Math.round((px / 96) * 1000) / 1000;
/** px de letra → puntos. */
const pt = (px: number): number => Math.round(px * 0.75 * 10) / 10;

export async function downloadPptx(deck: Deck, report: StudyReport, fileName: string): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title;
  pptx.subject = 'Resultados de un estudio de usabilidad';
  pptx.company = 'Taptana';
  pptx.author = 'Taptana';

  const slides = visibleSlides(deck);
  slides.forEach((slide, index) => {
    const page = pptx.addSlide();
    page.background = { color: 'FFFFFF' };
    const shapes = layoutSlide(slide, { index, total: slides.length, deckTitle: deck.title, heatmapViewport: heatmapViewport(slide, report) });
    for (const s of shapes) draw(pptx, page, s);
    if (slide.takeaway && slide.kind !== 'cover') page.addNotes(slide.takeaway);
  });

  await pptx.writeFile({ fileName: `${fileName}.pptx`, compression: true });
}

type Pptx = InstanceType<typeof import('pptxgenjs').default>;
type PptxSlide = ReturnType<Pptx['addSlide']>;

function draw(pptx: Pptx, page: PptxSlide, s: Shape): void {
  switch (s.type) {
    case 'text':
      if (!s.text) return;
      page.addText(s.text, {
        x: inch(s.x),
        y: inch(s.y),
        w: inch(s.w),
        h: inch(s.h),
        fontFace: PPTX_FONT,
        fontSize: pt(s.size),
        color: s.color,
        bold: s.bold ?? false,
        italic: s.italic ?? false,
        align: s.align ?? 'left',
        valign: s.valign ?? 'top',
        margin: 0,
        lineSpacingMultiple: s.lineHeight,
        charSpacing: s.upper ? 1 : 0,
        wrap: true,
        fit: 'none',
      });
      return;
    case 'rect':
      page.addShape(s.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
        x: inch(s.x),
        y: inch(s.y),
        w: inch(Math.max(1, s.w)),
        h: inch(Math.max(1, s.h)),
        fill: { color: s.fill },
        line: s.line ? { color: s.line, width: 0.75 } : { type: 'none' },
        ...(s.radius ? { rectRadius: inch(s.radius) } : {}),
      });
      return;
    case 'circle':
      page.addShape(pptx.ShapeType.ellipse, { x: inch(s.x), y: inch(s.y), w: inch(s.d), h: inch(s.d), fill: { color: s.fill }, line: { type: 'none' } });
      return;
    case 'heatmap':
      page.addShape(pptx.ShapeType.roundRect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: SOFT }, line: { type: 'none' }, rectRadius: inch(24) });
      page.addText(
        [
          { text: `Pantalla «${s.screenName}»`, options: { bold: true, fontSize: 16, breakLine: true } },
          { text: 'El mapa de calor se ve en el reporte de Taptana y en el PDF de esta presentación.', options: { fontSize: 12 } },
        ],
        { x: inch(s.x + 28), y: inch(s.y), w: inch(s.w - 56), h: inch(s.h), fontFace: PPTX_FONT, color: MUTED, align: 'center', valign: 'middle', margin: 0, lineSpacingMultiple: 1.3 },
      );
      return;
  }
}
