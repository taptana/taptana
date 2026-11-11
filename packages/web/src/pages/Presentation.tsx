import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileDown, MonitorPlay, Presentation, RotateCcw, X } from 'lucide-react';
import {
  applyDeckEdits,
  buildDeck,
  deckFileName,
  visibleSlides,
  type Deck,
  type DeckEdits,
  type Prototype,
  type ReportFilter,
  type Slide,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { EmptyState, ErrorState, Layout, PageHeader, PageSkeleton } from '@/components/layout';
import { clearSnapshotCache, whenSnapshotsReady } from '@/components/report/snapshot-view';
import type { EditKey } from '@/components/deck/layout';
import { ScaledSlide, SlideCanvas, useWidth } from '@/components/deck/slide-view';
import { SLIDE_H, SLIDE_W } from '@/components/deck/fit';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { Link } from '@/router';
import '@/report.css';
import '@/components/deck/deck.css';

interface Loaded {
  study: StudyRecord;
  report: StudyReport;
  proto: Prototype | undefined;
}

// ── Las ediciones quedan en este navegador, por estudio. Sin almacenamiento, igual funciona. ──

const storageKey = (id: string): string => `taptana.deck.${id}`;

function readEdits(id: string): DeckEdits {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DeckEdits) : {};
  } catch {
    return {};
  }
}

function writeEdits(id: string, edits: DeckEdits): void {
  try {
    if (Object.keys(edits).length === 0) localStorage.removeItem(storageKey(id));
    else localStorage.setItem(storageKey(id), JSON.stringify(edits));
  } catch {
    /* sin almacenamiento: los cambios duran mientras la página esté abierta */
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function PresentationPage({ id, filter }: { id: string; filter: ReportFilter }) {
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<DeckEdits>(() => readEdits(id));
  const [current, setCurrent] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState<'pptx' | 'pdf' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const filterKey = `${filter.variantId ?? ''}|${filter.device ?? ''}`;

  const load = useCallback(async (): Promise<void> => {
    setData(undefined);
    setError(null);
    try {
      const client = await getClient();
      const study = await client.getStudy(id);
      if (!study) {
        setData(null);
        return;
      }
      const [report, protos] = await Promise.all([client.getStudyReport(id, filter), client.listPrototypes().catch((): Prototype[] => [])]);
      if (!report) {
        setData(null);
        return;
      }
      setData({ study, report, proto: protos.find((p) => p.id === study.prototypeId) });
    } catch (e) {
      setError(friendlyError(e, 'No pudimos cargar los resultados. Revisa que el servidor de Taptana siga abierto y vuelve a intentarlo.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filterKey]);

  useEffect(() => {
    void load();
    return () => clearSnapshotCache();
  }, [load]);

  const base = useMemo((): Deck | null => (data ? buildDeck(data.study, data.report, data.proto ? { prototypeName: data.proto.name } : {}) : null), [data]);
  const deck = useMemo(() => (base ? applyDeckEdits(base, edits) : null), [base, edits]);
  const shown = useMemo(() => (deck ? visibleSlides(deck) : []), [deck]);
  const slides = deck?.slides ?? [];
  const at = Math.min(current, Math.max(0, slides.length - 1));
  const slide = slides[at];

  const updateEdits = useCallback(
    (fn: (prev: DeckEdits) => DeckEdits): void => {
      setEdits((prev) => {
        const next = fn(prev);
        writeEdits(id, next);
        return next;
      });
    },
    [id],
  );

  const edit = useCallback(
    (slideId: string, key: EditKey, value: string): void => {
      updateEdits((prev) => {
        const mine = { ...(prev[slideId] ?? {}) };
        if (key === 'title') mine.title = value;
        else if (key === 'takeaway') mine.takeaway = value;
        else mine.items = { ...(mine.items ?? {}), [key.slice(5)]: value };
        return { ...prev, [slideId]: mine };
      });
    },
    [updateEdits],
  );

  const toggleHidden = (s: Slide): void => {
    updateEdits((prev) => {
      const mine = { ...(prev[s.id] ?? {}) };
      if (s.hidden) delete mine.hidden;
      else mine.hidden = true;
      return { ...prev, [s.id]: mine };
    });
  };

  const go = useCallback((delta: number) => setCurrent((c) => Math.max(0, Math.min(slides.length - 1, c + delta))), [slides.length]);

  // ←/→ cambian de diapositiva (salvo mientras se escribe en un texto).
  useEffect(() => {
    if (presenting) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, presenting]);

  // Imprimir con Ctrl+P también deja solo las diapositivas.
  useEffect(() => {
    const on = (): void => flushSync(() => setPrinting(true));
    const off = (): void => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, []);

  if (error) {
    return (
      <Layout wide>
        <ErrorState message={error} onRetry={() => void load()} home />
      </Layout>
    );
  }
  if (!data || !deck) {
    if (data === null) {
      return (
        <Layout>
          <EmptyState
            icon={<Presentation className="size-5" />}
            title="Este estudio no existe"
            action={
              <Button asChild>
                <Link to={{ name: 'studies' }}>Ver mis estudios</Link>
              </Button>
            }
          >
            Puede que lo hayan borrado o que el link esté incompleto.
          </EmptyState>
        </Layout>
      );
    }
    return (
      <Layout wide>
        <PageSkeleton variant="cards" />
      </Layout>
    );
  }

  const { study, report, proto } = data;
  const fileName = deckFileName(deck.title);
  const edited = Object.keys(edits).length > 0;

  const downloadPptx = async (): Promise<void> => {
    if (shown.length === 0) return void toast.error('Todas las diapositivas están escondidas. Muestra al menos una.');
    setBusy('pptx');
    try {
      const { downloadPptx: save } = await import('@/components/deck/pptx');
      await save(deck, report, fileName);
      toast.success('PowerPoint descargado. Se abre en PowerPoint, Keynote o Google Slides, y puedes editar todo.');
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo armar el PowerPoint. Inténtalo de nuevo.'));
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async (): Promise<void> => {
    if (shown.length === 0) return void toast.error('Todas las diapositivas están escondidas. Muestra al menos una.');
    setBusy('pdf');
    setPrinting(true);
    try {
      await wait(250);
      await whenSnapshotsReady();
      window.print();
    } finally {
      setBusy(null);
      if (!window.matchMedia('print').matches) setPrinting(false);
    }
  };

  const present = (): void => {
    if (shown.length === 0) return void toast.error('Todas las diapositivas están escondidas. Muestra al menos una.');
    setPresenting(true);
  };

  const ctx = (s: Slide): { index: number; total: number; deckTitle: string } => ({ index: Math.max(0, shown.indexOf(s)), total: shown.length, deckTitle: deck.title });

  return (
    <Layout wide>
      <div className="tt-deck-screen space-y-8 sm:space-y-10">
        <PageHeader
          back={
            <Button variant="ghost" size="icon" asChild className="mt-1">
              <Link to={{ name: 'report', id }} aria-label="Volver a los resultados">
                <ArrowLeft />
              </Link>
            </Button>
          }
          title="Presentación"
          description={
            <span>
              {study.name} · {shown.length === slides.length ? `${slides.length} diapositivas` : `${shown.length} de ${slides.length} diapositivas`} · se arma sola con los resultados
            </span>
          }
          actions={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={busy !== null}>
                    <Download />
                    {busy === 'pptx' ? 'Armando…' : busy === 'pdf' ? 'Preparando…' : 'Descargar'}
                    <ChevronDown className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem onSelect={() => void downloadPptx()} data-testid="download-pptx">
                    <FileDown />
                    <span className="flex flex-col">
                      <span>PowerPoint (.pptx)</span>
                      <span className="text-xs text-muted-foreground">Textos y gráficos editables</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void downloadPdf()} data-testid="download-pdf">
                    <FileDown />
                    <span className="flex flex-col">
                      <span>PDF</span>
                      <span className="text-xs text-muted-foreground">En el diálogo, elige «Guardar como PDF»</span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={present}>
                <MonitorPlay />
                Presentar
              </Button>
            </>
          }
        />
        {report.filter && <p className="-mt-4 text-sm text-muted-foreground">{deck.slides[0]?.kind === 'cover' ? deck.slides[0].filter : ''}. Para cambiarlo, vuelve a los resultados.</p>}

        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
          <nav aria-label="Diapositivas" className="hidden lg:block">
            <ol className="space-y-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-2 lg:-mr-2 py-1">
              {slides.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setCurrent(i)}
                    aria-current={i === at ? 'true' : undefined}
                    aria-label={`Diapositiva ${i + 1}: ${s.title}${s.hidden ? ' (escondida)' : ''}`}
                    className={cn(
                      'group flex w-full cursor-pointer items-start gap-2 rounded-lg p-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      i === at ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                    data-testid="deck-thumb"
                  >
                    <span className="w-5 shrink-0 pt-1 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className={cn('relative block overflow-hidden rounded-md border bg-white shadow-xs', i === at && 'ring-2 ring-foreground/70', s.hidden && 'opacity-40')}>
                      <ScaledSlide width={168}>
                        <SlideCanvas slide={s} ctx={ctx(s)} report={report} proto={proto} lite />
                      </ScaledSlide>
                      {s.hidden && (
                        <span className="absolute inset-0 grid place-items-center">
                          <EyeOff className="size-5 text-foreground" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 space-y-4">
            {slide && <CurrentSlide slide={slide} ctx={ctx(slide)} report={report} proto={proto} onEdit={(key, value) => edit(slide.id, key, value)} />}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => go(-1)} disabled={at === 0} aria-label="Diapositiva anterior">
                  <ChevronLeft />
                </Button>
                <span className="min-w-20 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite" data-testid="deck-position">
                  {at + 1} de {slides.length}
                </span>
                <Button variant="ghost" size="icon" onClick={() => go(1)} disabled={at >= slides.length - 1} aria-label="Diapositiva siguiente">
                  <ChevronRight />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {slide && (
                  <Button variant="outline" size="sm" onClick={() => toggleHidden(slide)}>
                    {slide.hidden ? <Eye /> : <EyeOff />}
                    {slide.hidden ? 'Mostrar diapositiva' : 'Esconder diapositiva'}
                  </Button>
                )}
                {edited && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                    <RotateCcw />
                    Restablecer
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {slide?.hidden
                ? 'Esta diapositiva está escondida: no sale al presentar ni en las descargas.'
                : 'Toca un título o una frase para cambiarla. Los cambios quedan guardados en este navegador.'}
            </p>
          </div>
        </div>
      </div>

      {presenting && <PresentMode slides={shown} start={Math.max(0, slide ? shown.indexOf(slide) : 0)} deckTitle={deck.title} report={report} proto={proto} onClose={() => setPresenting(false)} />}

      {printing && (
        <div className="tt-deck-print" aria-hidden="true">
          {shown.map((s, i) => (
            <div key={s.id} className="tt-deck-page">
              <SlideCanvas slide={s} ctx={{ index: i, total: shown.length, deckTitle: deck.title }} report={report} proto={proto} eager />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Volver a la presentación original?"
        description="Se borran tus cambios de textos y vuelven a mostrarse todas las diapositivas. Los resultados no cambian."
        confirmLabel="Restablecer"
        onConfirm={() => {
          updateEdits(() => ({}));
          toast.success('Presentación restablecida.');
        }}
      />
    </Layout>
  );
}

/** La diapositiva grande, editable, al ancho disponible. */
function CurrentSlide({ slide, ctx, report, proto, onEdit }: { slide: Slide; ctx: { index: number; total: number; deckTitle: string }; report: StudyReport; proto: Prototype | undefined; onEdit: (key: EditKey, value: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <ScaledSlide width={width} className={cn('rounded-xl border bg-white shadow-sm', slide.hidden && 'opacity-50')}>
          <div data-testid="deck-slide" data-kind={slide.kind}>
            <SlideCanvas key={slide.id} slide={slide} ctx={ctx} report={report} proto={proto} editable onEdit={onEdit} />
          </div>
        </ScaledSlide>
      )}
    </div>
  );
}

/** Pantalla completa: flechas, espacio o un clic para avanzar; Esc para salir. */
function PresentMode({ slides, start, deckTitle, report, proto, onClose }: { slides: Slide[]; start: number; deckTitle: string; report: StudyReport; proto: Prototype | undefined; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const el = root.current;
    // Si el navegador no deja (iPhone), queda igual a toda la ventana.
    el?.requestFullscreen?.().catch(() => {});
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight });
    const onFs = (): void => {
      if (!document.fullscreenElement) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        setI((x) => Math.min(slides.length - 1, x + 1));
      } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        setI((x) => Math.max(0, x - 1));
      } else if (e.key === 'Home') setI(0);
      else if (e.key === 'End') setI(slides.length - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [slides.length, onClose]);

  const slide = slides[i];
  const width = Math.floor(Math.min(size.w, (size.h * SLIDE_W) / SLIDE_H));
  return (
    <div
      ref={root}
      className="fixed inset-0 z-50 grid place-items-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Presentación a pantalla completa"
      data-testid="present-mode"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        setI((x) => Math.min(slides.length - 1, x + 1));
      }}
    >
      {slide && (
        <ScaledSlide width={width}>
          <SlideCanvas key={slide.id} slide={slide} ctx={{ index: i, total: slides.length, deckTitle }} report={report} proto={proto} />
        </ScaledSlide>
      )}
      <div className="tt-present-controls absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900/85 px-2 py-1 text-white">
        <button type="button" className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-white/15" onClick={() => setI((x) => Math.max(0, x - 1))} aria-label="Anterior">
          <ChevronLeft className="size-5" />
        </button>
        <span className="min-w-16 text-center text-sm tabular-nums">
          {i + 1} / {slides.length}
        </span>
        <button type="button" className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-white/15" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))} aria-label="Siguiente">
          <ChevronRight className="size-5" />
        </button>
        <button type="button" className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-white/15" onClick={onClose} aria-label="Salir (Esc)">
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
