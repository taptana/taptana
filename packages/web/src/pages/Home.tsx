import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Info } from 'lucide-react';
import { EXAMPLE_PROTOTYPE_ID, EXAMPLE_STUDY_ID, type Prototype, type SessionSummary, type StudyRecord } from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ErrorState, Layout, Notice } from '@/components/layout';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TapBoard } from '@/components/brand/art';
import { Link, useRouter, type Route } from '@/router';

interface HomeData {
  prototypes: Prototype[];
  studies: StudyRecord[];
  sessions: SessionSummary[];
}

interface Step {
  title: string;
  /** Qué hacer (pendiente) o qué hay (hecho). */
  text: string;
  done: boolean;
  action: { label: string; to: Route } | null;
  /** Por qué todavía no se puede. */
  blocked?: string;
}

function buildSteps({ prototypes, studies, sessions }: HomeData): Step[] {
  // El ejemplo no cuenta como avance propio: los pasos hablan de tu prototipo y tu estudio.
  const ownProtos = prototypes.filter((p) => p.id !== EXAMPLE_PROTOTYPE_ID && p.source !== undefined);
  const ownStudies = studies.filter((s) => s.id !== EXAMPLE_STUDY_ID && s.prototypeId !== EXAMPLE_PROTOTYPE_ID);
  const ownIds = new Set(ownStudies.map((s) => s.id));
  const ownSessions = sessions.filter((s) => s.studyId && ownIds.has(s.studyId));
  const latestStudy = [...ownStudies].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const latestSession = [...ownSessions].sort((a, b) => b.startedAt - a.startedAt)[0];
  const resultsStudy = latestSession?.studyId ?? latestStudy?.id;

  return [
    {
      title: 'Sube tu prototipo',
      done: ownProtos.length > 0,
      text:
        ownProtos.length > 0
          ? `Tienes ${plural(ownProtos.length, 'prototipo', 'prototipos')}: ${ownProtos
              .slice(0, 2)
              .map((p) => p.name)
              .join(', ')}${ownProtos.length > 2 ? '…' : ''}`
          : 'Un archivo .html o un .zip con tu prototipo, tal como lo hiciste. No hay que cambiarle nada.',
      action: { label: ownProtos.length > 0 ? 'Ver prototipos' : 'Subir prototipo', to: { name: 'prototypes' } },
    },
    {
      title: 'Crea un estudio',
      done: ownStudies.length > 0,
      text:
        ownStudies.length > 0
          ? `Tienes ${plural(ownStudies.length, 'estudio', 'estudios')}. El más reciente: «${latestStudy?.name ?? ''}».`
          : 'Escribe las tareas que le vas a pedir a cada persona y, si quieres, algunas preguntas. Puedes probarlo sin grabar.',
      action: ownStudies.length > 0 ? { label: 'Ver estudios', to: { name: 'studies' } } : { label: 'Crear estudio', to: { name: 'study', id: null } },
      ...(ownProtos.length === 0 && ownStudies.length === 0 ? { blocked: 'Primero sube un prototipo.' } : {}),
    },
    {
      title: 'Comparte el link',
      done: ownSessions.length > 0,
      text:
        ownSessions.length > 0
          ? `Ya ${ownSessions.length === 1 ? 'participó 1 persona' : `participaron ${ownSessions.length} personas`}.`
          : IS_DEMO
            ? 'En la demo el link solo funciona en este navegador: ábrelo tú mismo para ver cómo lo vive un participante.'
            : 'Cada persona abre el link (o escanea el QR) en su celular, conectado a la misma red Wi-Fi que esta computadora.',
      action: latestStudy ? { label: 'Compartir link', to: { name: 'study', id: latestStudy.id } } : null,
      ...(latestStudy ? {} : { blocked: 'Primero crea un estudio.' }),
    },
    {
      title: 'Mira los resultados',
      done: false,
      text:
        ownSessions.length > 0
          ? 'El reporte te dice qué tareas se lograron, dónde se trabó la gente y qué conviene arreglar. También puedes ver cada grabación.'
          : 'Cuando alguien termine, aquí verás qué tareas se lograron, dónde se trabó la gente y la grabación de cada sesión.',
      action: ownSessions.length > 0 && resultsStudy ? { label: 'Ver resultados', to: { name: 'report', id: resultsStudy } } : null,
      ...(ownSessions.length > 0 ? {} : { blocked: 'Todavía no hay sesiones.' }),
    },
  ];
}

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const { navigate } = useRouter();

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const client = await getClient();
      const [prototypes, studies, sessions] = await Promise.all([client.listPrototypes(), client.listStudies(), client.listSessions()]);
      setData({ prototypes, studies, sessions });
    } catch (e) {
      setError(friendlyError(e, 'No pudimos leer tus prototipos y estudios.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const openExample = async (): Promise<void> => {
    setLoadingExample(true);
    try {
      const client = await getClient();
      const { studyId } = await client.loadExample();
      navigate({ name: 'report', id: studyId });
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo cargar el ejemplo. Intenta de nuevo.'));
    } finally {
      setLoadingExample(false);
    }
  };

  const steps = data ? buildSteps(data) : null;
  const current = steps ? steps.findIndex((s) => !s.done) : -1;
  const next = steps && current >= 0 ? steps[current] : undefined;

  return (
    <Layout>
      <section className="pt-1 sm:pt-2 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-12 lg:gap-16">
        <div className="min-w-0">
          <p className="type-eyebrow">Pruebas de usabilidad · prototipos HTML</p>
          <h1 className="mt-5 max-w-[14ch] font-display text-[2.75rem] sm:text-[4rem] lg:text-[4.5rem] font-extrabold tracking-[-0.035em] leading-[0.98]">
            Prueba tu prototipo con <span className="mark whitespace-nowrap">personas reales</span>
          </h1>
          <p className="mt-7 max-w-[52ch] text-lg leading-relaxed text-foreground/85">
            Sube tu prototipo, arma las tareas, comparte un link y mira qué pasó: quién lo logró, dónde se trabó y la grabación de cada sesión.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {next?.action && !next.blocked ? (
              <Button size="lg" asChild>
                <Link to={next.action.to}>
                  {next.action.label} <ArrowRight />
                </Link>
              </Button>
            ) : (
              <Button size="lg" asChild>
                <Link to={{ name: 'prototypes' }}>
                  Subir prototipo <ArrowRight />
                </Link>
              </Button>
            )}
            <button
              type="button"
              disabled={loadingExample}
              onClick={() => void openExample()}
              className="link-ink min-h-11 cursor-pointer rounded-sm text-base font-medium outline-none focus-ink disabled:opacity-60"
            >
              {loadingExample ? 'Cargando el ejemplo…' : 'Ver un ejemplo'}
            </button>
          </div>
          <p className="mt-5 max-w-[52ch] text-sm text-muted-foreground leading-relaxed">
            El ejemplo es una tienda con un estudio ya hecho y varios participantes, para que veas un reporte completo antes de armar el tuyo.
          </p>
        </div>
        <figure className="hidden md:block w-[300px] lg:w-[360px] shrink-0">
          <div className="rounded-xl border border-foreground bg-card p-2">
            <TapBoard className="w-full" />
          </div>
          <figcaption className="type-eyebrow mt-3 flex justify-between gap-4">
            <span>Fig. 1 — El camino de una persona</span>
            <span className="whitespace-nowrap">6 toques</span>
          </figcaption>
        </figure>
      </section>

      {IS_DEMO && (
        <Notice tone="warning" icon={<Info />} title="Estás en la demo: todo vive en este navegador">
          <p>Puedes subir tu prototipo, armar un estudio, hacerlo tú como participante y ver el reporte. Nada se envía a ningún servidor.</p>
          <p>
            Lo que no se puede aquí: compartir el link con otra persona o abrirlo en un celular. Para probar con gente de verdad, instala Taptana en tu
            computadora (es gratis y de código abierto) y arráncalo con <code className="text-foreground">pnpm start</code>.
          </p>
        </Notice>
      )}

      <section aria-labelledby="pasos" className="border-t border-foreground pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-5">
          <h2 id="pasos" className="type-section">
            Tu primera prueba, en 4 pasos
          </h2>
          {steps && (
            <p className="type-eyebrow flex items-center gap-2.5">
              <span aria-hidden className="flex gap-1">
                {steps.map((s) => (
                  <span key={s.title} className={cn('size-2 rounded-full border', s.done ? 'border-foreground bg-foreground' : 'border-input')} />
                ))}
              </span>
              {steps.filter((s) => s.done).length} de 4 listos
            </p>
          )}
        </div>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !steps ? (
          <div className="space-y-3" aria-busy="true" aria-label="Cargando">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          <ol className="border-t">
            {steps.map((step, i) => (
              <StepItem key={step.title} step={step} index={i} current={i === current} />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="que-es" className="border-t border-foreground pt-5">
        <h2 id="que-es" className="type-section">
          Qué es Taptana
        </h2>
        <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-3">
          <Fact index="Formato" title="Funciona con tu HTML">
            Prototipos hechos con IA o a mano: varias páginas, una sola página o un solo archivo. Se suben tal cual.
          </Fact>
          <Fact index="Dispositivo" title="En celulares reales">
            Cada persona usa el prototipo en su propio celular. Se graba lo que toca y por dónde navega, sin video.
          </Fact>
          <Fact index="Privacidad" title="Tus datos son tuyos">
            {IS_DEMO
              ? 'Es de código abierto y se instala donde quieras. Lo que alguien escribe en el prototipo nunca se guarda.'
              : 'Todo queda en esta computadora. Lo que alguien escribe en el prototipo nunca se guarda.'}
          </Fact>
        </div>
      </section>
    </Layout>
  );
}

/**
 * Un paso del recorrido, como fila de una lista con reglas: número en mono, título, una línea y
 * la acción a la derecha. El paso actual lleva el número resaltado y el texto completo.
 */
function StepItem({ step, index, current }: { step: Step; index: number; current: boolean }) {
  const future = !step.done && !current;
  return (
    <li className={cn('grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-b py-5 sm:grid-cols-[3.5rem_minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-6', future && 'text-muted-foreground')}>
      <span className="num text-[15px] font-medium" aria-hidden>
        <span className={cn(current && 'mark')}>{String(index + 1).padStart(2, '0')}</span>
      </span>
      <h3 className={cn('text-[17px] leading-snug', current ? 'font-semibold' : 'font-medium')}>
        <span className="sr-only">Paso {index + 1}: </span>
        {step.title}
        {step.done && (
          <>
            <Check className="ml-2 inline size-4 align-[-2px]" aria-hidden />
            <span className="sr-only"> Listo.</span>
          </>
        )}
      </h3>
      <p className={cn('col-start-2 sm:col-start-auto max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground', !current && 'sm:truncate')}>
        {current || step.done ? step.text : (step.blocked ?? step.text)}
      </p>
      <div className="col-start-2 sm:col-start-auto sm:justify-self-end">
        {current ? (
          step.action && !step.blocked ? (
            <Button asChild>
              <Link to={step.action.to}>{step.action.label}</Link>
            </Button>
          ) : (
            step.blocked && <p className="text-sm text-muted-foreground">{step.blocked}</p>
          )
        ) : (
          step.done &&
          step.action && (
            <Link to={step.action.to} className="link-ink text-sm text-foreground">
              {step.action.label}
            </Link>
          )
        )}
      </div>
    </li>
  );
}

function Fact({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="type-eyebrow">
        {index}
      </p>
      <h3 className="type-subsection">{title}</h3>
      <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[42ch]">{children}</p>
    </div>
  );
}
