import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, BarChart3, Check, FileArchive, FlaskConical, Info, Lock, Share2, Smartphone, Sparkles, Code2 } from 'lucide-react';
import { EXAMPLE_PROTOTYPE_ID, EXAMPLE_STUDY_ID, type Prototype, type SessionSummary, type StudyRecord } from '@taptana/shared';
import { getClient, IS_DEMO } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ErrorState, Layout, Notice } from '@/components/layout';
import { friendlyError } from '@/lib/errors';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HeroArt } from '@/components/brand/art';
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
  icon: typeof FileArchive;
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
      icon: FileArchive,
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
      icon: FlaskConical,
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
      icon: Share2,
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
      icon: BarChart3,
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
      <section className="relative pt-2 sm:pt-4 pb-2 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-10">
        <div className="min-w-0">
        <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[13px] font-medium text-foreground/80">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          Pruebas de usabilidad para prototipos HTML
        </p>
        <h1 className="mt-5 max-w-3xl text-[2.375rem] sm:text-[3.5rem] font-bold tracking-[-0.01em] text-balance leading-[1.05]">
          Prueba tu prototipo con <span className="whitespace-nowrap">personas reales</span>
        </h1>
        <p className="mt-6 max-w-[60ch] text-muted-foreground text-lg leading-relaxed">
          Sube tu prototipo, arma las tareas, comparte un link y mira qué pasó: quién lo logró, dónde se trabó y la grabación de cada sesión.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
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
          <Button size="lg" variant="outline" disabled={loadingExample} onClick={() => void openExample()}>
            <Sparkles /> {loadingExample ? 'Cargando el ejemplo…' : 'Ver un ejemplo'}
          </Button>
        </div>
        <p className="mt-4 max-w-[65ch] text-sm text-muted-foreground leading-relaxed">
          El ejemplo es una tienda con un estudio ya hecho y varios participantes, para que veas un reporte completo antes de armar el tuyo.
        </p>
        </div>
        <HeroArt className="hidden md:block w-[300px] lg:w-[340px] shrink-0" />
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

      <section aria-labelledby="pasos" className="space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pasos" className="type-section">
            Tu primera prueba, en 4 pasos
          </h2>
          {steps && (
            <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <span aria-hidden className="flex gap-1">
                {steps.map((s) => (
                  <span key={s.title} className={cn('size-2 rounded-full', s.done ? 'bg-primary' : 'bg-input')} />
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
              <Skeleton key={i} className={cn('rounded-xl', i === 0 ? 'h-36' : 'h-12')} />
            ))}
          </div>
        ) : (
          <ol className="relative">
            {steps.map((step, i) => (
              <StepItem key={step.title} step={step} index={i} current={i === current} last={i === steps.length - 1} />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="que-es" className="space-y-6">
        <h2 id="que-es" className="type-section">
          Qué es Taptana
        </h2>
        <div className="grid gap-4 sm:gap-6 sm:grid-cols-3">
          <Fact icon={<Code2 className="size-5" />} title="Funciona con tu HTML">
            Prototipos hechos con IA o a mano: varias páginas, una sola página o un solo archivo. Se suben tal cual.
          </Fact>
          <Fact icon={<Smartphone className="size-5" />} title="En celulares reales">
            Cada persona usa el prototipo en su propio celular. Se graba lo que toca y por dónde navega, sin video.
          </Fact>
          <Fact icon={<Lock className="size-5" />} title="Tus datos son tuyos">
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
 * Un paso del recorrido. Solo el paso actual se abre (texto y botón); los hechos muestran una
 * marca y una línea; los que vienen quedan en gris, en una sola línea.
 */
function StepItem({ step, index, current, last }: { step: Step; index: number; current: boolean; last: boolean }) {
  const Icon = step.icon;
  const future = !step.done && !current;
  return (
    <li className="relative flex gap-4 sm:gap-5">
      {!last && <span aria-hidden className="absolute left-[17px] top-10 bottom-0 w-0.5 -translate-x-px rounded-full bg-[radial-gradient(circle,var(--input)_1.5px,transparent_1.6px)] bg-[length:4px_8px]" />}
      <div
        className={cn(
          'relative z-10 size-9 shrink-0 rounded-full grid place-items-center font-display text-[15px] font-bold tabular-nums',
          step.done ? 'bg-foreground text-background' : current ? 'bg-primary text-primary-foreground ring-4 ring-primary/15' : 'border bg-card text-muted-foreground',
        )}
        aria-hidden
      >
        {step.done ? <Check className="size-4.5" /> : index + 1}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : current ? 'pb-8' : 'pb-6')}>
        {current ? (
          <div className="rounded-2xl border bg-card shadow-sm p-(--card-pad) space-y-4 -mt-1">
            <div className="space-y-2">
              <h3 className="type-subsection flex flex-wrap items-center gap-2.5">
                <Icon className="size-[18px] text-muted-foreground" aria-hidden />
                <span>
                  <span className="sr-only">Paso {index + 1}: </span>
                  {step.title}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary">Sigue aquí</span>
              </h3>
              <p className="max-w-[65ch] text-muted-foreground leading-relaxed">{step.text}</p>
            </div>
            {step.action && !step.blocked ? (
              <Button asChild>
                <Link to={step.action.to}>{step.action.label}</Link>
              </Button>
            ) : (
              step.blocked && <p className="text-sm text-muted-foreground">{step.blocked}</p>
            )}
          </div>
        ) : (
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className={cn('text-[17px] font-medium', future && 'text-muted-foreground')}>
              <span className="sr-only">Paso {index + 1}: </span>
              {step.title}
            </h3>
            {step.done && (
              <>
                <span className="sr-only">Listo.</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{step.text}</span>
                {step.action && (
                  <Link to={step.action.to} className="text-sm text-muted-foreground underline decoration-primary/40 underline-offset-4 hover:text-primary hover:decoration-primary">
                    {step.action.label}
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-(--card-pad) space-y-3">
      <div className="size-10 rounded-lg grid place-items-center bg-muted text-foreground/75">{icon}</div>
      <h3 className="type-subsection pt-1">{title}</h3>
      <p className="text-[15px] text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
