/**
 * Columna central del constructor: el editor de lo que está seleccionado (ajustes, bienvenida,
 * un bloque o la despedida). Campos en lenguaje claro, con ayuda y el error junto a cada uno.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, CircleCheck, Crosshair, Lightbulb, Play, Plus, Route as RouteIcon, TriangleAlert, Video, X } from 'lucide-react';
import {
  DEFAULT_CONSENT_TEXT,
  DEFAULT_THANKS_TEXT,
  SCALE_SIZES,
  STUDY_LIMITS,
  newBlockId,
  sameScreen,
  screenId,
  type ChoiceBlock,
  type ContextBlock,
  type Prototype,
  type QuestionBlock,
  type ScaleBlock,
  type ScreenInfo,
  type StudyIssue,
  type StudyVariant,
  type SuccessRule,
  type TaskReport,
  type TextBlock,
} from '@taptana/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { commonPath, emptyRule, fieldError, missedScreens, moveItem, rulesFor, samePathList, type DraftStudy, type DraftTask } from './draft';
import { Field, KIND_INFO, OptionCards, ScreenName, ScreenPicker } from './fields';

// ── Piezas comunes ───────────────────────────────────────────────────────

export function EditorCard({ icon, kicker, title, children, actions }: { icon?: ReactNode; kicker: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b px-(--card-pad) py-5">
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow">{kicker}</p>
          <h2 className="type-section mt-1 truncate">{title}</h2>
        </div>
        {actions}
      </header>
      <div className="divide-y px-(--card-pad)">{children}</div>
    </section>
  );
}

/**
 * Un paso del editor: número, título corto y sus campos, con aire alrededor. Así cada bloque se
 * lee como una serie de decisiones, una a la vez.
 */
function Step({ n, title, hint, children }: { n?: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-5 py-10 first:pt-8 last:pb-8">
      <header className="space-y-1.5">
        <h3 className="type-subsection flex items-center gap-2.5">
          {n !== undefined && <span className="num w-7 shrink-0 text-sm font-normal text-muted-foreground">{String(n).padStart(2, '0')}</span>}
          {title}
        </h3>
        {hint && <p className={cn('max-w-[65ch] text-[15px] leading-relaxed text-muted-foreground', n !== undefined && 'pl-9.5')}>{hint}</p>}
      </header>
      <div className={cn('space-y-7', n !== undefined && 'sm:pl-9.5')}>{children}</div>
    </section>
  );
}

/** «Opciones avanzadas» al final del editor: cerrado salvo que ya tenga algo. */
function AdvancedStep({ children, defaultOpen = false, label = 'Opciones avanzadas' }: { children: ReactNode; defaultOpen?: boolean; label?: string }) {
  return (
    <details className="group py-6" open={defaultOpen || undefined}>
      <summary className="flex min-h-10 w-fit cursor-pointer list-none items-center gap-2 rounded-md text-[15px] font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="space-y-6 pt-6 sm:pl-6">{children}</div>
    </details>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-t pt-4">
      <span className="min-w-0">
        <span className="block text-[15px] leading-snug font-medium">{label}</span>
        {hint && <span className="mt-1 block max-w-[65ch] text-xs leading-relaxed text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

function Advanced({ label = 'Avanzado', children, defaultOpen = false }: { label?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group border-l-2 border-input" open={defaultOpen || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm px-3 py-2.5 text-[15px] font-medium outline-none select-none focus-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="space-y-4 px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}

/** Consejos plegados: se abren solo si se quieren leer. */
function Tips({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group text-sm">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md text-muted-foreground outline-none select-none hover:text-foreground focus-ink [&::-webkit-details-marker]:hidden">
        <Lightbulb className="size-4 shrink-0" />
        {title}
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3 max-w-[65ch] space-y-1.5 border-l-2 border-input py-1 pl-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

/** Quita las claves vacías ('' o undefined) que el formato trata como "no está". */
function prune<T extends object>(value: T, keys: Array<keyof T>): T {
  const out = { ...value };
  for (const key of keys) {
    const v = out[key];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === false) delete out[key];
  }
  return out;
}

// ── Ajustes del estudio ──────────────────────────────────────────────────

export function SettingsEditor({
  draft,
  onChange,
  errors,
  protos,
  screens,
  saved,
}: {
  draft: DraftStudy;
  onChange: (next: DraftStudy) => void;
  errors: readonly StudyIssue[];
  protos: readonly Prototype[];
  screens: readonly ScreenInfo[];
  /** El estudio ya existe (se puede cerrar). */
  saved: boolean;
}) {
  const known = protos.some((p) => p.id === draft.prototypeId);
  const variants = draft.variants ?? [];
  const setVariants = (next: StudyVariant[]): void => onChange(prune({ ...draft, variants: next }, ['variants']));
  const setSettings = (patch: NonNullable<DraftStudy['settings']>): void => {
    const settings = prune({ ...draft.settings, ...patch }, ['askName']);
    if (settings.advance === 'auto') delete settings.advance;
    const next = { ...draft, settings };
    if (Object.keys(settings).length === 0) delete (next as Partial<DraftStudy>).settings;
    onChange(next);
  };
  const protoError = fieldError(errors, undefined, 'prototypeId') ?? (!known ? (protos.length === 0 ? 'Todavía no hay prototipos. Sube uno en "Prototipos" y vuelve.' : 'Este prototipo ya no está aquí. Elige otro.') : undefined);

  return (
    <EditorCard kicker="Estudio" title="Ajustes del estudio">
      <Step n={1} title="Lo básico">
      <Field label="Nombre del estudio" error={fieldError(errors, undefined, 'name')} help="Solo lo ve tu equipo y aparece en la bienvenida.">
        {(p) => <Input {...p} value={draft.name} maxLength={STUDY_LIMITS.name} placeholder="Compra de una planta" onChange={(e) => onChange({ ...draft, name: e.target.value })} />}
      </Field>
      <Field label="¿Qué quieres aprender?" optional error={fieldError(errors, undefined, 'description')} help="Una frase para recordar el objetivo. El participante no la ve.">
        {(p) => (
          <Textarea {...p} value={draft.description ?? ''} maxLength={STUDY_LIMITS.text} placeholder="Saber si el flujo de compra se entiende sin ayuda" onChange={(e) => onChange(prune({ ...draft, description: e.target.value }, ['description']))} />
        )}
      </Field>
      <Field label="Prototipo" error={protoError} help="El prototipo sobre el que se hacen las tareas.">
        {(p) => (
          <NativeSelect {...p} aria-invalid={p['aria-invalid'] || !known} value={known ? draft.prototypeId : ''} onChange={(e) => onChange({ ...draft, prototypeId: e.target.value })}>
            {!known && <option value="">Elige un prototipo…</option>}
            {protos.map((proto) => (
              <option key={proto.id} value={proto.id}>
                {proto.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      </Step>

      <Step n={2} title="Cómo avanza">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1.5 text-[15px] font-medium">Avance al cumplir la tarea</legend>
        <OptionCards
          name="Avance al cumplir la tarea"
          value={draft.settings?.advance ?? 'auto'}
          onChange={(advance) => setSettings({ advance })}
          options={[
            { value: 'auto', label: 'Automático', hint: 'Cuando se cumple la regla aparece "¡Listo!" y pasa al siguiente bloque. Es lo más cómodo para el participante.' },
            { value: 'manual', label: 'Espera a que toque "Listo"', hint: 'El participante decide cuándo terminó. Sirve para ver si se da cuenta de que ya lo logró.' },
          ]}
        />
      </fieldset>

      {saved && (
        <SwitchRow
          label="Recibe respuestas"
          hint={draft.closed ? 'Cerrado: quien abra el link verá que el estudio ya no recibe respuestas.' : 'Quien abra el link puede participar. Apágalo cuando termines la prueba.'}
          checked={!draft.closed}
          onChange={(open) => onChange(prune({ ...draft, closed: !open }, ['closed']))}
        />
      )}
      </Step>

      <AdvancedStep label="Opciones avanzadas: comparar dos versiones (A/B)" defaultOpen={variants.length > 0}>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cada participante recibe una variante al azar y su primera tarea empieza en la pantalla de esa variante. El reporte compara los resultados de cada una. Si no lo necesitas, déjalo vacío.
        </p>
        {fieldError(errors, undefined, 'variants') && <p className="text-sm text-destructive">{fieldError(errors, undefined, 'variants')}</p>}
        {variants.map((v, i) => (
          <div key={v.id} className="space-y-2 border-l-2 border-input py-1 pl-4">
            <div className="flex items-center gap-2">
              <Input aria-label={`Nombre de la variante ${i + 1}`} value={v.name} maxLength={STUDY_LIMITS.name} placeholder={`Variante ${'ABCDEFGH'[i] ?? i + 1}`} onChange={(e) => setVariants(variants.map((x) => (x.id === v.id ? { ...x, name: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Quitar la variante ${v.name || i + 1}`} onClick={() => setVariants(variants.filter((x) => x.id !== v.id))}>
                <X />
              </Button>
            </div>
            <ScreenPicker
              value={v.startPath ?? ''}
              screens={screens}
              urlOnly
              placeholder="Pantalla donde empieza esta variante"
              onChange={(startPath) => setVariants(variants.map((x) => (x.id === v.id ? prune({ ...x, startPath }, ['startPath']) : x)))}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const id = newBlockId(variants.map((v) => v.id.replace(/^v_/, 'b_'))).replace(/^b_/, 'v_');
            setVariants([...variants, { id, name: `Variante ${'ABCDEFGH'[variants.length] ?? variants.length + 1}` }]);
          }}
        >
          <Plus /> Agregar variante
        </Button>
      </AdvancedStep>
    </EditorCard>
  );
}

// ── Bienvenida y despedida ───────────────────────────────────────────────

export function WelcomeEditor({ draft, onChange, errors }: { draft: DraftStudy; onChange: (next: DraftStudy) => void; errors: readonly StudyIssue[] }) {
  return (
    <EditorCard kicker="Lo primero que ve el participante" title="Bienvenida">
      <Step n={1} title="El saludo">
      <Field label="Texto de bienvenida" optional error={fieldError(errors, undefined, 'welcome')} help="Dos líneas: qué va a pasar y que no hay respuestas incorrectas.">
        {(p) => (
          <Textarea
            {...p}
            value={draft.welcome ?? ''}
            maxLength={STUDY_LIMITS.text}
            placeholder="Gracias por ayudarnos. Vas a usar un prototipo: nada es real y no hay respuestas incorrectas."
            onChange={(e) => onChange(prune({ ...draft, welcome: e.target.value }, ['welcome']))}
          />
        )}
      </Field>
      </Step>
      <Step n={2} title="El consentimiento" hint="Hasta que el participante lo acepte no se graba nada.">
      <Field
        label="Consentimiento"
        optional
        error={fieldError(errors, undefined, 'consent')}
        help="Si lo dejas vacío se usa el texto estándar."
      >
        {(p) => <Textarea {...p} value={draft.consent ?? ''} maxLength={STUDY_LIMITS.text} placeholder={DEFAULT_CONSENT_TEXT} onChange={(e) => onChange(prune({ ...draft, consent: e.target.value }, ['consent']))} />}
      </Field>
      {!draft.consent && (
        <div className="border-l-2 border-input py-1 pl-4 text-sm">
          <p className="mb-1.5 text-sm font-medium text-foreground/80">Texto estándar que verá el participante</p>
          <p>{DEFAULT_CONSENT_TEXT}</p>
        </div>
      )}
      </Step>
      <AdvancedStep defaultOpen={draft.settings?.askName === true}>
      <SwitchRow
        label="Pedir nombre o alias"
        hint="Agrega el campo «¿Cómo te llamas? (opcional)». Sirve para reconocer cada sesión en los resultados."
        checked={draft.settings?.askName === true}
        onChange={(askName) => {
          const settings = prune({ ...draft.settings, askName }, ['askName']);
          const next = { ...draft, settings };
          if (Object.keys(settings).length === 0) delete (next as Partial<DraftStudy>).settings;
          onChange(next);
        }}
      />
      </AdvancedStep>
    </EditorCard>
  );
}

export function ThanksEditor({ draft, onChange, errors }: { draft: DraftStudy; onChange: (next: DraftStudy) => void; errors: readonly StudyIssue[] }) {
  return (
    <EditorCard kicker="Lo último que ve el participante" title="Gracias">
      <Step title="La despedida" hint="Al llegar aquí la grabación se detiene sola.">
      <Field label="Texto de despedida" optional error={fieldError(errors, undefined, 'thanks')} help={`Si lo dejas vacío se usa: "${DEFAULT_THANKS_TEXT}"`}>
        {(p) => <Textarea {...p} value={draft.thanks ?? ''} maxLength={STUDY_LIMITS.text} placeholder={DEFAULT_THANKS_TEXT} onChange={(e) => onChange(prune({ ...draft, thanks: e.target.value }, ['thanks']))} />}
      </Field>
      </Step>
    </EditorCard>
  );
}

// ── Tarea y primer clic ──────────────────────────────────────────────────

/** ¿La regla "llega a una pantalla" apunta al final del camino (o no hay camino escrito)? */
function endsOnGoal(expectedPath: readonly string[] | undefined, goal: string): boolean {
  const last = expectedPath?.[expectedPath.length - 1];
  return last === undefined || sameScreen(last, goal);
}

const RULE_TEXT: Record<'task' | 'first-click', Partial<Record<SuccessRule['type'], { label: string; hint: string }>>> = {
  task: {
    reached: { label: 'Llega a una pantalla', hint: 'Se cumple cuando aparece la pantalla que elijas. Lo mejor cuando el flujo termina en una pantalla clara.' },
    tapped: { label: 'Toca un elemento', hint: 'Se cumple al tocar un botón, un enlace u otro elemento concreto.' },
    visible: { label: 'Aparece un texto o elemento', hint: 'Se cumple cuando en pantalla aparece algo, como "Pedido confirmado". Sirve si el prototipo no cambia de pantalla.' },
    manual: { label: 'Lo decide el moderador', hint: 'Tú marcas después si lo logró, viendo la grabación. Mientras tanto queda "por revisar".' },
  },
  'first-click': {
    tapped: { label: 'Toca el elemento correcto', hint: 'Acierta si su primer toque cae en el elemento que elijas.' },
    reached: { label: 'Su toque lo lleva a una pantalla', hint: 'Acierta si su primer toque abre la pantalla que elijas.' },
  },
};

export interface TaskTools {
  screens: readonly ScreenInfo[];
  phoneScreen: string | undefined;
  /** Elementos de la pantalla del teléfono que coinciden con el selector actual; null si no se sabe. */
  matches: number | null;
  picking: boolean;
  recording: boolean;
  onRecord: () => void;
  onPick: () => void;
  onCancelPick: () => void;
  onTryout: () => void;
  /** El estudio avanza solo al cumplirse la regla (ajuste "Avance al cumplir la tarea"). */
  autoAdvance: boolean;
  /** Cambia el ajuste a «espera a que toque "Listo"». */
  onManualAdvance: () => void;
  /** Los resultados de esta tarea, si el estudio ya tiene sesiones. */
  report: TaskReport | undefined;
}

function MatchNote({ selector, matches }: { selector: string; matches: number | null }) {
  if (!selector.trim() || matches === null) return null;
  if (matches === 0) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        No está en la pantalla que muestra el teléfono ahora. Si vive en otra pantalla, navega hasta ella para comprobarlo.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
      Coincide con {plural(matches, 'elemento', 'elementos')} en la pantalla del teléfono.{matches > 1 ? ' Tocar cualquiera de ellos cuenta.' : ''}
    </p>
  );
}

function PickButton({ tools, label = 'Elegir en el prototipo' }: { tools: TaskTools; label?: string }) {
  if (tools.picking) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-l-2 border-foreground py-1 pl-4 text-sm">
        <Crosshair className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">Toca el elemento en el teléfono…</span>
        <Button type="button" variant="outline" size="sm" onClick={tools.onCancelPick}>
          Cancelar
        </Button>
      </div>
    );
  }
  return (
    <Button type="button" variant="outline" onClick={tools.onPick}>
      <Crosshair /> {label}
    </Button>
  );
}

function PathEditor({ path, onChange, tools }: { path: string[]; onChange: (path: string[]) => void; tools: TaskTools }) {
  const [text, setText] = useState('');
  const add = (): void => {
    if (!text.trim()) return;
    onChange([...path, screenId(text.trim())]);
    setText('');
  };
  return (
    <div className="space-y-3">
      {path.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Camino esperado, en orden">
          {path.map((screen, i) => (
            <li key={`${screen}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="inline-flex items-center gap-0.5 rounded-sm border py-0.5 pr-1 pl-2.5 text-sm">
                <span className="num mr-1.5 text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                <ScreenName id={screen} screens={tools.screens} className="max-w-36 truncate" />
                <button type="button" className="ml-1 grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none" aria-label={`Mover ${screen} antes`} disabled={i === 0} onClick={() => onChange(moveItem(path, i, i - 1))}>
                  <ArrowLeft className="size-3.5" />
                </button>
                <button type="button" className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none" aria-label={`Mover ${screen} después`} disabled={i === path.length - 1} onClick={() => onChange(moveItem(path, i, i + 1))}>
                  <ArrowRight className="size-3.5" />
                </button>
                <button type="button" className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Quitar ${screen} del camino`} onClick={() => onChange(path.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div
        className="flex flex-wrap gap-2"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            add();
          }
        }}
      >
        <div className="min-w-56 flex-1">
          <ScreenPicker value={text} onChange={setText} screens={tools.screens} phoneScreen={tools.phoneScreen} placeholder="Siguiente pantalla del camino" />
        </div>
        <Button type="button" variant="outline" disabled={!text.trim()} onClick={add}>
          <Plus /> Agregar
        </Button>
      </div>
    </div>
  );
}

export function TaskEditor({ block, index, onChange, errors, tools }: { block: DraftTask; index: number; onChange: (next: DraftTask) => void; errors: readonly StudyIssue[]; tools: TaskTools }) {
  const kind = block.kind ?? 'task';
  const info = KIND_INFO[kind];
  const rule = block.success;
  const set = (patch: Partial<DraftTask>): void => onChange(prune({ ...block, ...patch }, ['startPath', 'expectedPath']));
  const setRule = (success: SuccessRule): void => set({ success: success.type === 'visible' ? prune(success, ['text', 'selector']) : success });
  const err = (...fields: string[]): string | undefined => fieldError(errors, block.id, ...fields);
  const ruleOptions = rulesFor(kind).map((type) => ({ value: type, ...(RULE_TEXT[kind][type] as { label: string; hint: string }) }));
  const ruleError = err('success');

  const common = tools.report ? commonPath(tools.report.paths) : null;
  const missed = tools.report ? missedScreens(block.expectedPath, tools.report.results) : [];
  const canUseCommon = kind === 'task' && common !== null && !samePathList(common, block.expectedPath);

  return (
    <EditorCard kicker={`Bloque ${index + 1} · ${info.label}`} title={block.title || info.untitled}>
      <div className="flex flex-wrap items-center gap-2 py-6">
        {kind === 'first-click' ? (
          // Primer clic: no hay camino que grabar, solo un lugar que tocar. El toque no navega.
          <Button type="button" variant={tools.picking ? 'default' : 'outline'} onClick={tools.picking ? tools.onCancelPick : tools.onPick} aria-pressed={tools.picking}>
            <Crosshair /> {tools.picking ? 'Esperando tu toque… (cancelar)' : 'Elegir en el prototipo'}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={tools.onRecord} disabled={tools.recording} className="disabled:opacity-100 disabled:border-foreground">
            <Video className="text-red-600" /> {tools.recording ? 'Grabando el camino…' : 'Grabar el camino correcto'}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={tools.onTryout}>
          <Play /> {kind === 'first-click' ? 'Probar este primer clic' : 'Probar esta tarea'}
        </Button>
        <p className="w-full max-w-[65ch] text-xs leading-relaxed text-muted-foreground">
          {kind === 'first-click'
            ? tools.picking
              ? 'Toca en el teléfono el lugar correcto. Tu toque no cambia de pantalla.'
              : 'Toca en el teléfono el lugar correcto y Taptana anota el elemento. Probar no graba nada.'
            : tools.recording
              ? 'Haz la tarea en el teléfono y pulsa "Usar este camino".'
              : 'Haz la tarea tú en el teléfono y llenamos la pantalla de inicio, el camino y la regla. Probar no graba nada.'}
        </p>
      </div>

      <Step n={1} title="Qué le pides">
      <Field label="Título" error={err('title')} help="Solo para tu equipo: así se llama en los resultados.">
        {(p) => <Input {...p} value={block.title} maxLength={STUDY_LIMITS.name} placeholder={kind === 'first-click' ? 'Encontrar el carrito' : 'Comprar una planta grande'} onChange={(e) => set({ title: e.target.value })} />}
      </Field>

      <Field label="Instrucción" error={err('instruction')} help="Lo que lee el participante en su celular.">
        {(p) => (
          <Textarea
            {...p}
            value={block.instruction}
            maxLength={STUDY_LIMITS.instruction}
            placeholder={kind === 'first-click' ? '¿Dónde tocarías para ver lo que llevas en tu carrito?' : 'Quieres regalar una planta a tu mamá. Encuentra una grande y cómprala.'}
            onChange={(e) => set({ instruction: e.target.value })}
          />
        )}
      </Field>
      <Tips title="Cómo escribir una buena instrucción">
        <p>Plantea una situación ("Quieres regalar…") en vez de dar órdenes paso a paso.</p>
        <p>No uses las palabras que aparecen en la interfaz ("toca Carrito"): le estarías dando la respuesta.</p>
        <p>Una sola meta por tarea, con un final claro.</p>
      </Tips>
      </Step>

      <Step n={2} title="Dónde empieza">
      <Field
        label="Pantalla de inicio"
        optional={kind !== 'first-click'}
        error={err('startPath')}
        help={
          kind === 'first-click'
            ? 'Donde se hace la pregunta. Revisa que el elemento correcto esté en ella.'
            : 'Si la dejas vacía, sigue donde quedó en el bloque anterior.'
        }
      >
        {(p) => <ScreenPicker {...p} value={block.startPath ?? ''} onChange={(startPath) => set({ startPath })} screens={tools.screens} phoneScreen={tools.phoneScreen} urlOnly />}
      </Field>
      {kind === 'first-click' && !block.startPath && (
        <p className="-mt-4 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Sin pantalla de inicio, la pregunta se hace donde el participante haya quedado, y ahí puede no estar lo que buscas.
        </p>
      )}
      </Step>

      <Step n={3} title={kind === 'first-click' ? 'Cuál es el toque correcto' : 'Cuándo se logra'}>
      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-1.5 text-[15px] font-medium">{kind === 'first-click' ? '¿Cuál es el toque correcto?' : '¿Cómo se sabe que lo logró?'}</legend>
        <OptionCards name={`Regla de éxito de ${block.title || 'la tarea'}`} value={rule?.type} options={ruleOptions} onChange={(type) => type !== rule?.type && set({ success: emptyRule(type) })} />
        {!rule && ruleError && <p className="text-sm text-destructive">{ruleError}</p>}

        {rule?.type === 'reached' && (
          <Field label="¿A qué pantalla tiene que llegar?" error={err('success.path', 'success')}>
            {(p) => <ScreenPicker {...p} value={rule.path} onChange={(path) => setRule({ type: 'reached', path })} screens={tools.screens} phoneScreen={tools.phoneScreen} />}
          </Field>
        )}
        {kind === 'task' && rule?.type === 'reached' && rule.path.trim() && tools.autoAdvance && endsOnGoal(block.expectedPath, rule.path) && (
          <div className="flex max-w-[65ch] gap-3 border-l-2 border-input py-1 pl-4 text-sm leading-relaxed text-muted-foreground" data-testid="auto-advance-hint">
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 space-y-2.5">
              <p>Al llegar, la tarea termina sola y el participante pasa al siguiente paso sin detenerse en esa pantalla. Si quieres que la vea, elige «espera a que toque Listo».</p>
              <Button type="button" size="sm" variant="outline" className="h-auto min-h-10 whitespace-normal py-2 text-left sm:min-h-9" onClick={tools.onManualAdvance}>
                Cambiar a «espera a que toque Listo»
              </Button>
              <p>Este ajuste vale para todo el estudio (está en «Ajustes del estudio»).</p>
            </div>
          </div>
        )}

        {rule?.type === 'tapped' && (
          <div className="space-y-3">
            {rule.selector ? (
              <div className="space-y-1.5 border-l-2 border-input py-1 pl-4">
                <p className="text-sm">
                  Elemento elegido: <code className="font-mono text-xs break-all text-foreground">{rule.selector}</code>
                </p>
                <MatchNote selector={rule.selector} matches={tools.matches} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {kind === 'first-click'
                  ? 'Pulsa «Elegir en el prototipo» y toca en el teléfono el lugar correcto; Taptana anota el elemento. No hace falta saber de código.'
                  : 'Pulsa el botón y luego toca el elemento en el teléfono de la derecha. No hace falta saber de código.'}
              </p>
            )}
            {!rule.selector && err('success.selector', 'success') && <p className="text-sm text-destructive">{err('success.selector', 'success')}</p>}
            <PickButton tools={tools} label={rule.selector ? 'Elegir otro en el prototipo' : 'Elegir en el prototipo'} />
            <Advanced>
              <Field label="Selector CSS" error={err('success.selector')} help='Para quien conoce el HTML: por ejemplo "#agregar" o ".cart-link".'>
                {(p) => <Input {...p} value={rule.selector} spellCheck={false} autoCapitalize="none" className="font-mono text-sm" onChange={(e) => setRule({ type: 'tapped', selector: e.target.value })} />}
              </Field>
            </Advanced>
          </div>
        )}

        {rule?.type === 'visible' && (
          <div className="space-y-3">
            <Field label="Texto que tiene que aparecer" error={err('success', 'success.text')} help='Por ejemplo "Pedido confirmado". No importan mayúsculas ni minúsculas.'>
              {(p) => <Input {...p} value={rule.text ?? ''} maxLength={STUDY_LIMITS.question} onChange={(e) => setRule({ ...rule, text: e.target.value })} />}
            </Field>
            <Advanced label="Avanzado: que aparezca un elemento" defaultOpen={Boolean(rule.selector)}>
              <Field label="Selector CSS del elemento" optional error={err('success.selector')} help="Se cumple cuando ese elemento está visible. Puedes usarlo en vez del texto, o junto con él.">
                {(p) => <Input {...p} value={rule.selector ?? ''} spellCheck={false} autoCapitalize="none" className="font-mono text-sm" onChange={(e) => setRule({ ...rule, selector: e.target.value })} />}
              </Field>
              <MatchNote selector={rule.selector ?? ''} matches={tools.matches} />
              <PickButton tools={tools} />
            </Advanced>
          </div>
        )}

        {rule?.type === 'manual' && (
          <p className="border-l-2 border-input py-1 pl-4 text-sm text-muted-foreground">
            Taptana no puede saber sola si lo logró. Cuando el participante toque "Listo", el resultado queda <strong className="font-medium text-foreground">por revisar</strong> hasta que lo marques en la grabación.
          </p>
        )}
      </fieldset>
      </Step>

      {kind === 'task' && (
        <AdvancedStep defaultOpen={(block.expectedPath?.length ?? 0) > 0 || missed.length > 0 || Boolean(err('expectedPath'))}>
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-1.5 flex items-center gap-2 text-[15px] font-medium">
            <RouteIcon className="size-4 text-muted-foreground" /> Camino esperado <span className="text-xs font-normal text-muted-foreground">opcional</span>
          </legend>
          <p className="max-w-[65ch] text-xs leading-relaxed text-muted-foreground">
            Las pantallas del camino ideal, en orden. Seguirlo tal cual cuenta como <strong className="font-medium text-foreground">éxito directo</strong>; vacío, se usa el más común.
          </p>
          {err('expectedPath') && <p className="text-sm text-destructive">{err('expectedPath')}</p>}
          {missed.length > 0 && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Al camino esperado le falta una pantalla que casi todos visitan</AlertTitle>
              <AlertDescription>
                <p>
                  La mayoría de quienes lo lograron pasó por{' '}
                  {missed.map((m, i) => (
                    <span key={m}>
                      {i > 0 && ', '}
                      <ScreenName id={m} screens={tools.screens} className="font-medium text-foreground" />
                    </span>
                  ))}
                  . Sin {missed.length === 1 ? 'ella' : 'ellas'} en el camino, nadie cuenta como éxito directo.
                </p>
                {common && (
                  <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => set({ expectedPath: common })}>
                    Usar el camino más común
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          <PathEditor path={block.expectedPath ?? []} onChange={(expectedPath) => set({ expectedPath })} tools={tools} />
          {canUseCommon && missed.length === 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => set({ expectedPath: common })}>
              <RouteIcon /> Usar el camino más común de los participantes
            </Button>
          )}
        </fieldset>
        </AdvancedStep>
      )}
    </EditorCard>
  );
}

// ── Preguntas ────────────────────────────────────────────────────────────

const QUESTION_PLACEHOLDER: Record<QuestionBlock['kind'], string> = {
  scale: '¿Qué tan fácil fue completar la compra?',
  choice: '¿Qué fue lo más difícil?',
  yesno: '¿Volverías a usar esta tienda?',
  text: '¿Qué cambiarías?',
};

function OptionsEditor({ block, onChange, error }: { block: ChoiceBlock; onChange: (next: ChoiceBlock) => void; error: string | undefined }) {
  const options = block.options;
  const setOptions = (next: string[]): void => onChange({ ...block, options: next });
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1.5 text-[15px] font-medium">Opciones</legend>
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="num w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
          <Input aria-label={`Opción ${i + 1}`} value={option} maxLength={STUDY_LIMITS.option} placeholder={`Opción ${i + 1}`} onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))} />
          <Button type="button" variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={`Subir la opción ${i + 1}`} disabled={i === 0} onClick={() => setOptions(moveItem(options, i, i - 1))}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={`Bajar la opción ${i + 1}`} disabled={i === options.length - 1} onClick={() => setOptions(moveItem(options, i, i + 1))}>
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Quitar la opción ${i + 1}`} disabled={options.length <= STUDY_LIMITS.minOptions} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={options.length >= STUDY_LIMITS.maxOptions} onClick={() => setOptions([...options, ''])}>
          <Plus /> Agregar opción
        </Button>
        <span className="text-xs text-muted-foreground">
          Entre {STUDY_LIMITS.minOptions} y {STUDY_LIMITS.maxOptions} opciones.
        </span>
      </div>
    </fieldset>
  );
}

function ScaleEditor({ block, onChange, errors }: { block: ScaleBlock; onChange: (next: ScaleBlock) => void; errors: readonly StudyIssue[] }) {
  return (
    <>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1.5 text-[15px] font-medium">Tamaño de la escala</legend>
        <div className="inline-flex gap-0.5 rounded-md border border-input p-0.5" role="radiogroup" aria-label="Tamaño de la escala">
          {SCALE_SIZES.map((max) => (
            <button
              key={max}
              type="button"
              role="radio"
              aria-checked={block.max === max}
              onClick={() => onChange({ ...block, max })}
              className={cn('num cursor-pointer rounded-sm px-4 py-1.5 text-sm font-medium outline-none focus-ink', block.max === max ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
            >
              1 a {max}
            </button>
          ))}
        </div>
        {fieldError(errors, block.id, 'max') && <p className="text-sm text-destructive">{fieldError(errors, block.id, 'max')}</p>}
        <p className="text-xs text-muted-foreground">5 es lo más fácil de responder en un celular. Usa 10 para "¿qué tan probable es que lo recomiendes?".</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Etiqueta del 1" optional error={fieldError(errors, block.id, 'minLabel')}>
          {(p) => <Input {...p} value={block.minLabel ?? ''} maxLength={STUDY_LIMITS.label} placeholder="Muy difícil" onChange={(e) => onChange(prune({ ...block, minLabel: e.target.value }, ['minLabel']))} />}
        </Field>
        <Field label={`Etiqueta del ${block.max}`} optional error={fieldError(errors, block.id, 'maxLabel')}>
          {(p) => <Input {...p} value={block.maxLabel ?? ''} maxLength={STUDY_LIMITS.label} placeholder="Muy fácil" onChange={(e) => onChange(prune({ ...block, maxLabel: e.target.value }, ['maxLabel']))} />}
        </Field>
      </div>
    </>
  );
}

export function QuestionEditor({ block, index, onChange, errors }: { block: QuestionBlock; index: number; onChange: (next: QuestionBlock) => void; errors: readonly StudyIssue[] }) {
  const info = KIND_INFO[block.kind];
  const err = (...fields: string[]): string | undefined => fieldError(errors, block.id, ...fields);
  const set = (patch: Partial<QuestionBlock>): void => onChange(prune({ ...block, ...patch } as QuestionBlock, ['description', 'required']));
  return (
    <EditorCard kicker={`Bloque ${index + 1} · ${info.label}`} title={block.question || info.untitled}>
      <Step n={1} title="Qué preguntas">
      <Field label="Pregunta" error={err('question')} help="Es lo que lee el participante.">
        {(p) => <Textarea {...p} value={block.question} maxLength={STUDY_LIMITS.question} placeholder={QUESTION_PLACEHOLDER[block.kind]} onChange={(e) => set({ question: e.target.value })} />}
      </Field>
      </Step>

      <Step n={2} title="Cómo responde">
      {block.kind === 'scale' && <ScaleEditor block={block} onChange={onChange} errors={errors} />}
      {block.kind === 'choice' && (
        <>
          <OptionsEditor block={block} onChange={onChange} error={err('options')} />
          <SwitchRow
            label="Se pueden marcar varias"
            hint="Apagado, el participante elige una sola."
            checked={block.multiple === true}
            onChange={(multiple) => onChange(prune({ ...block, multiple }, ['multiple']))}
          />
        </>
      )}
      {block.kind === 'yesno' && <p className="text-sm text-muted-foreground">El participante verá dos botones grandes: Sí y No.</p>}
      {block.kind === 'text' && (
        <Field label="Texto de ayuda dentro del campo" optional error={err('placeholder')}>
          {(p) => <Input {...p} value={block.placeholder ?? ''} maxLength={STUDY_LIMITS.label} placeholder="Escribe aquí…" onChange={(e) => onChange(prune({ ...(block as TextBlock), placeholder: e.target.value }, ['placeholder']))} />}
        </Field>
      )}

      </Step>

      <AdvancedStep defaultOpen={Boolean(block.description) || block.required === true || Boolean(err('description'))}>
        <Field label="Aclaración" optional error={err('description')} help="Una línea más pequeña debajo de la pregunta.">
          {(p) => <Input {...p} value={block.description ?? ''} maxLength={STUDY_LIMITS.question} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        <SwitchRow label="Obligatoria" hint="Encendido, no se puede saltar. Apagado, aparece «Saltar»." checked={block.required === true} onChange={(required) => set({ required })} />
      </AdvancedStep>
    </EditorCard>
  );
}

// ── Contexto ─────────────────────────────────────────────────────────────

export function ContextEditor({ block, index, onChange, errors }: { block: ContextBlock; index: number; onChange: (next: ContextBlock) => void; errors: readonly StudyIssue[] }) {
  const info = KIND_INFO.context;
  return (
    <EditorCard kicker={`Bloque ${index + 1} · ${info.label}`} title={block.title || info.untitled}>
      <Step title="Qué lee el participante" hint='Lo lee y toca "Continuar". No se le pide nada.'>
      <Field label="Título" error={fieldError(errors, block.id, 'title')}>
        {(p) => <Input {...p} value={block.title} maxLength={STUDY_LIMITS.name} placeholder="Antes de seguir" onChange={(e) => onChange({ ...block, title: e.target.value })} />}
      </Field>
      <Field label="Texto" error={fieldError(errors, block.id, 'text')} help='Pon en situación: "Imagina que ya compraste y quieres saber cuándo llega".'>
        {(p) => <Textarea {...p} value={block.text} maxLength={STUDY_LIMITS.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />}
      </Field>
      </Step>
    </EditorCard>
  );
}
