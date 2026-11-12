/**
 * Diálogos y paneles del constructor: compartir, probar como participante, crear con IA,
 * importar un study.json y el panel de "Grabar el camino correcto".
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CircleCheck, ClipboardPaste, Copy, ExternalLink, EyeOff, FileUp, Hand, MonitorSmartphone, Plug, RotateCcw, Smartphone, Sparkles, Wifi } from 'lucide-react';
import {
  TRYOUT_PARAM,
  TRYOUT_WINDOW,
  blockTitle,
  type Prototype,
  type RecorderMessage,
  type ScreenInfo,
  type ServerInfo,
  type Study,
  type StudyRecord,
  type SuccessRule,
} from '@taptana/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TapBurst } from '@/components/brand/art';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { copyText } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { MCP_DOC_URL, mcpSnippets } from '@/lib/mcp';
import { buildStudyPrompt } from '@/lib/prompt';
import { nameScreen } from '@/lib/screens';
import { demoResult, parseStudyText, type DemoStep } from './draft';
import { KIND_INFO, ScreenName } from './fields';
import { PhoneFrame, type PhoneHandle } from './PhoneFrame';

async function copy(text: string, done: string): Promise<void> {
  if (await copyText(text)) toast.success(done);
  else toast.error('Tu navegador no dejó copiar. Selecciona el texto y cópialo a mano.');
}

// ── Compartir ────────────────────────────────────────────────────────────

export function invitationText(link: string): string {
  return `¡Hola! Te invito a probar un prototipo desde tu celular. Toma unos minutos y no hay respuestas incorrectas: evaluamos el diseño, no a ti.\n\nAbre este link en tu celular:\n${link}\n\n¡Gracias por tu ayuda!`;
}

export function ShareDialog({
  open,
  onOpenChange,
  link,
  qr,
  demo,
  closed,
  problem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Link del participante; null si el estudio no tiene un prototipo válido. */
  link: string | null;
  qr: string | null;
  demo: boolean;
  closed: boolean;
  /** Por qué no hay link todavía. */
  problem?: string | undefined;
}) {
  const tryoutLink = link ? `${link}${link.includes('?') ? '&' : '?'}${TRYOUT_PARAM}=1` : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {link && !closed && <TapBurst className="mb-1" />}
          <DialogTitle>Compartir el estudio</DialogTitle>
          <DialogDescription>Cada persona que abra el link en su celular es una sesión nueva.</DialogDescription>
        </DialogHeader>
        {!link ? (
          <Alert variant="warning">
            <AlertTitle>Todavía no hay link</AlertTitle>
            <AlertDescription>{problem ?? 'Elige un prototipo en "Ajustes del estudio" y guarda el estudio.'}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            {closed && (
              <Alert variant="warning">
                <AlertTitle>El estudio está cerrado</AlertTitle>
                <AlertDescription>Quien abra el link verá que ya no recibe respuestas. Enciende "Recibe respuestas" en los ajustes para volver a abrirlo.</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {qr && <img src={qr} alt="Código QR con el link del estudio" className="mx-auto size-40 shrink-0 rounded-lg border bg-white p-2 sm:mx-0" />}
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="share-link" className="text-sm font-medium">
                    Link para participantes
                  </label>
                  <Input id="share-link" readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void copy(link, 'Link copiado')}>
                    <Copy /> Copiar link
                  </Button>
                  <Button variant="outline" onClick={() => void copy(invitationText(link), 'Invitación copiada')}>
                    <Hand /> Copiar invitación
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">"Copiar invitación" copia un mensaje amable con el link, listo para pegar en WhatsApp o correo.</p>
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">
              {demo ? <MonitorSmartphone className="mt-0.5 size-4 shrink-0" /> : <Wifi className="mt-0.5 size-4 shrink-0" />}
              {demo
                ? 'Esto es la demo: el link solo funciona en este navegador, porque los datos viven aquí. Para compartirlo con otras personas instala Taptana en tu computadora.'
                : 'Funciona en celulares conectados a la misma red Wi-Fi que esta computadora, mientras Taptana esté abierto.'}
            </p>
            {tryoutLink && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">Probar en mi celular</span>
                  <span className="block text-xs text-muted-foreground">Un link de prueba: recorre el estudio completo sin grabar nada.</span>
                </p>
                <Button variant="outline" size="sm" onClick={() => void copy(tryoutLink, 'Link de prueba copiado')}>
                  <Smartphone /> Copiar link de prueba
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Probar como participante ─────────────────────────────────────────────

export function TryoutDialog({
  open,
  onOpenChange,
  proto,
  study,
  startAt,
  screens = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proto: Prototype | undefined;
  /** Pantallas conocidas, para nombrarlas igual que en el constructor. */
  screens?: readonly ScreenInfo[];
  /** El borrador validado (con o sin id). */
  study: (Study & Partial<Pick<StudyRecord, 'id' | 'createdAt' | 'updatedAt'>>) | null;
  /** Probar solo desde este bloque. */
  startAt?: string | undefined;
}) {
  const phone = useRef<PhoneHandle>(null);
  const sent = useRef(false);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (open) {
      sent.current = false;
      setBlockId(null);
      setFinished(false);
    }
  }, [open]);

  const send = (): void => {
    if (!study) return;
    sent.current = true;
    setFinished(false);
    const now = Date.now();
    const record: StudyRecord = { ...study, id: study.id ?? '', createdAt: study.createdAt ?? now, updatedAt: study.updatedAt ?? now };
    phone.current?.post({ source: 'taptana-panel', type: 'study', study: record, ...(startAt ? { startAt } : {}) });
  };

  const onMessage = (msg: RecorderMessage): void => {
    if (msg.type === 'need-study') send();
    else if (msg.type === 'ready' && !sent.current) {
      // Si el recorder no llega a pedirlo (retomó una prueba anterior), se lo mandamos igual.
      window.setTimeout(() => {
        if (!sent.current) send();
      }, 400);
    } else if (msg.type === 'tryout') {
      if (msg.event === 'finish') setFinished(true);
      else setBlockId(msg.blockId ?? null);
    }
  };

  const blocks = study?.blocks ?? [];
  const index = blockId ? blocks.findIndex((b) => b.id === blockId) : -1;
  const current = index >= 0 ? blocks[index] : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>{startAt ? 'Probar esta tarea' : 'Probar el estudio'}</DialogTitle>
          <DialogDescription>Así lo verá el participante. Es una vista previa: no se graba ni se guarda nada.</DialogDescription>
        </DialogHeader>
        {open && study && (
          <PhoneFrame
            ref={phone}
            proto={proto}
            windowName={TRYOUT_WINDOW}
            screens={screens}
            onMessage={onMessage}
            // Escape cierra aunque el foco esté dentro del prototipo.
            onEscape={() => onOpenChange(false)}
            // La cinta "Vista previa" va aquí afuera, para no tapar la parte de arriba del prototipo.
            hideRibbon
            banner={
              <div className="space-y-2">
              <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300" role="status">
                <EyeOff className="size-3.5" /> Vista previa · no se graba
              </p>
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
                {finished ? (
                  <>
                    <CircleCheck className="size-4 shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 font-medium">Terminó la prueba</span>
                    <Button size="sm" variant="outline" onClick={send}>
                      <RotateCcw /> Probar de nuevo
                    </Button>
                  </>
                ) : current ? (
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">
                      {startAt ? '' : `Paso ${index + 1} de ${blocks.length} · `}
                      {KIND_INFO[current.kind ?? 'task'].label}:
                    </span>{' '}
                    {blockTitle(current)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{startAt ? 'Sigue la instrucción en el teléfono.' : 'Empieza por la bienvenida, como un participante.'}</span>
                )}
              </div>
              </div>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Crear con IA ─────────────────────────────────────────────────────────

function Problems({ messages }: { messages: string[] }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{messages.length === 1 ? 'Hay un problema con este estudio' : `Hay ${messages.length} problemas con este estudio`}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {messages.slice(0, 8).map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        {messages.length > 8 && <p>…y {messages.length - 8} más.</p>}
      </AlertDescription>
    </Alert>
  );
}

/** Un bloque de configuración para copiar, con su botón. */
function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <Button variant="ghost" size="sm" onClick={() => void copy(value, 'Copiado.')}>
          <Copy /> Copiar
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">{value}</pre>
    </div>
  );
}

/**
 * "Conecta tu IA (MCP)": la otra forma de armar el estudio. La IA se conecta a Taptana y ve los
 * prototipos y pantallas reales; Taptana sigue sin llamar a ningún modelo.
 */
function McpSection({ info, demo }: { info: ServerInfo | undefined; demo: boolean }) {
  const snippets = mcpSnippets({ origin: location.origin, local: Boolean(info?.panelKeyUrl), bin: info?.mcpBin });
  return (
    <details className="group rounded-xl border p-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Plug className="size-4 text-muted-foreground" /> Conecta tu IA (MCP)
        <span className="text-xs font-normal text-muted-foreground">sin copiar y pegar</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          Si usas Claude Desktop, Claude Code, Cursor o LM Studio, puedes conectarlos a Taptana. Tu IA verá tus prototipos y sus pantallas, armará el estudio, lo revisará y
          lo guardará aquí. Después lo revisas tú, como siempre.
        </p>
        {demo ? (
          <Alert variant="warning">
            <AlertTitle>Necesitas Taptana instalado</AlertTitle>
            <AlertDescription>Esta demo vive solo en tu navegador, así que una IA no tiene a qué conectarse. Instala Taptana en tu computadora y vuelve a este cuadro.</AlertDescription>
          </Alert>
        ) : (
          <>
            {!info?.panelKeyUrl && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Estás en otro dispositivo: la configuración lleva la llave del panel. Cámbiala por lo que va después de «key=» en el link que muestra Taptana al arrancar.
              </p>
            )}
            <Snippet label="Con la dirección (Cursor, LM Studio y otras)" value={snippets.http} />
            <Snippet label="Claude Code (en la terminal)" value={snippets.claudeCode} />
            <Snippet label="Con un comando (Claude Desktop y otras; Taptana tiene que estar corriendo)" value={snippets.stdio} />
          </>
        )}
        <a href={MCP_DOC_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
          Cómo configurarlo, paso a paso <ExternalLink className="size-3" />
        </a>
      </div>
    </details>
  );
}

export function AiDialog({
  open,
  onOpenChange,
  proto,
  screens,
  replaces,
  onApply,
  info,
  demo = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proto: Prototype | undefined;
  screens: readonly ScreenInfo[];
  /** El borrador ya tiene bloques: usar el JSON los reemplaza. */
  replaces: boolean;
  onApply: (study: Study) => void;
  /** Datos del servidor, para la configuración del MCP. */
  info?: ServerInfo | undefined;
  /** Demo estática: no hay servidor al que conectar una IA. */
  demo?: boolean;
}) {
  const [goal, setGoal] = useState('');
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setProblems(null);
      setCopied(false);
    }
  }, [open]);

  const copyPrompt = async (): Promise<void> => {
    if (!proto) return;
    const prompt = buildStudyPrompt({ prototypeId: proto.id, prototypeName: proto.name, screens: screens.map((s) => ({ id: s.id, ...(s.title ? { title: s.title } : {}) })), goal });
    if (await copyText(prompt)) {
      setCopied(true);
      toast.success('Prompt copiado. Pégalo en tu IA.');
    } else toast.error('Tu navegador no dejó copiar el prompt.');
  };

  const apply = (): void => {
    const parsed = parseStudyText(text);
    if (!parsed.ok) {
      setProblems(parsed.messages);
      return;
    }
    onApply(parsed.study);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Armar el estudio con una IA</DialogTitle>
          <DialogDescription>Taptana no llama a ninguna IA: tú copias un prompt, lo pegas en la que uses (ChatGPT, Claude, Gemini…) y traes de vuelta su respuesta.</DialogDescription>
        </DialogHeader>
        {!proto ? (
          <Alert variant="warning">
            <AlertTitle>Primero elige un prototipo</AlertTitle>
            <AlertDescription>El prompt lleva la lista de pantallas del prototipo. Elígelo en "Ajustes del estudio".</AlertDescription>
          </Alert>
        ) : (
          <ol className="space-y-5">
            <li className="space-y-2">
              <label htmlFor="ai-goal" className="block text-sm font-medium">
                1. ¿Qué quieres averiguar? <span className="text-xs font-normal text-muted-foreground">opcional</span>
              </label>
              <Textarea id="ai-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Si la gente encuentra el carrito y entiende el costo de envío" />
              <Button variant={copied ? 'outline' : 'default'} onClick={() => void copyPrompt()}>
                {copied ? <Check /> : <Sparkles />} {copied ? 'Prompt copiado' : 'Copiar prompt para IA'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Incluye el formato del estudio y {screens.length > 0 ? `las ${screens.length} pantallas de "${proto.name}"` : `el nombre de "${proto.name}" (aún no hay pantallas detectadas)`}.
              </p>
            </li>
            <li className="space-y-2">
              <label htmlFor="ai-json" className="block text-sm font-medium">
                2. Pega aquí la respuesta de la IA
              </label>
              <Textarea
                id="ai-json"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setProblems(null);
                }}
                spellCheck={false}
                className="max-h-56 min-h-28 font-mono text-xs"
                placeholder='{ "v": 2, "name": "…", "blocks": [ … ] }'
              />
              {problems && <Problems messages={problems} />}
              {replaces && <p className="text-xs text-amber-700 dark:text-amber-400">Esto reemplaza los bloques y textos que tienes ahora en este estudio.</p>}
            </li>
          </ol>
        )}
        <McpSection info={info} demo={demo} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!proto || !text.trim()} onClick={apply}>
            <ClipboardPaste /> Usar este estudio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Importar study.json ──────────────────────────────────────────────────

export function ImportDialog({
  open,
  onOpenChange,
  protos,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protos: readonly Prototype[];
  /** Guarda el estudio. Si lanza, el mensaje se muestra aquí. */
  onImport: (study: Study) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [study, setStudy] = useState<Study | null>(null);
  const [prototypeId, setPrototypeId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setFileName(null);
      setProblems(null);
      setStudy(null);
      setPrototypeId('');
    }
  }, [open]);

  const read = (source: string): void => {
    const parsed = parseStudyText(source);
    if (!parsed.ok) {
      setStudy(null);
      setProblems(parsed.messages);
      return;
    }
    setProblems(null);
    setStudy(parsed.study);
    setPrototypeId(protos.some((p) => p.id === parsed.study.prototypeId) ? parsed.study.prototypeId : protos.length === 1 ? (protos[0]?.id ?? '') : '');
  };

  const onFile = async (file: File): Promise<void> => {
    try {
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      read(content);
    } catch {
      setProblems(['No se pudo leer el archivo. Intenta de nuevo o pega su contenido.']);
    }
  };

  const submit = async (): Promise<void> => {
    if (!study || !prototypeId) return;
    setBusy(true);
    try {
      await onImport({ ...study, prototypeId });
      onOpenChange(false);
    } catch (e) {
      setProblems([friendlyError(e, 'No se pudo guardar el estudio. Intenta de nuevo.')]);
    } finally {
      setBusy(false);
    }
  };

  const missingProto = study !== null && !protos.some((p) => p.id === study.prototypeId);
  // Por qué todavía no se puede importar, dicho junto al botón.
  const blocked = busy
    ? null
    : problems
      ? 'Corrige lo que aparece arriba para poder importar.'
      : !text.trim()
        ? 'Elige un archivo o pega el JSON para continuar.'
        : !study
          ? 'Pulsa «Revisar» para comprobar el JSON antes de importar.'
          : protos.length === 0
            ? 'Falta un prototipo: sube uno en «Prototipos».'
            : !prototypeId
              ? 'Elige con qué prototipo vas a usar este estudio.'
              : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar estudio</DialogTitle>
          <DialogDescription>Trae un archivo study.json (exportado de Taptana o escrito por una IA), o pega su contenido.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUp /> Elegir archivo…
            </Button>
            {fileName && <span className="min-w-0 truncate text-sm text-muted-foreground">{fileName}</span>}
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="import-json" className="text-sm font-medium">
              O pega el JSON aquí
            </label>
            <Textarea
              id="import-json"
              value={text}
              spellCheck={false}
              className="max-h-56 min-h-28 font-mono text-xs"
              placeholder='{ "v": 2, "name": "…", "blocks": [ … ] }'
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setStudy(null);
                setProblems(null);
              }}
            />
            {!study && text.trim() && !problems && (
              <Button variant="outline" size="sm" onClick={() => read(text)}>
                Revisar
              </Button>
            )}
          </div>
          {problems && <Problems messages={problems} />}
          {study && (
            <div className="space-y-3 rounded-lg border bg-muted/40 px-4 py-3">
              <p className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  <span className="font-medium">{study.name}</span>
                  <span className="text-muted-foreground"> · {study.blocks.length === 1 ? '1 bloque' : `${study.blocks.length} bloques`}</span>
                </span>
              </p>
              {protos.length === 0 ? (
                <p className="text-sm text-destructive">Todavía no hay prototipos aquí. Sube uno en "Prototipos" y vuelve a importar el estudio.</p>
              ) : (
                <div className="space-y-1.5">
                  <label htmlFor="import-proto" className="text-sm font-medium">
                    {missingProto ? 'El prototipo de este estudio no está aquí. ¿Con cuál lo quieres usar?' : 'Prototipo'}
                  </label>
                  <NativeSelect id="import-proto" value={prototypeId} onChange={(e) => setPrototypeId(e.target.value)}>
                    {!prototypeId && <option value="">Elige un prototipo…</option>}
                    {protos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {missingProto && <p className="text-xs text-muted-foreground">Las pantallas de las tareas tienen que existir en el prototipo que elijas.</p>}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:items-center">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!study || !prototypeId || busy} aria-describedby={blocked ? 'import-blocked' : undefined} onClick={() => void submit()}>
            {busy ? 'Importando…' : 'Importar estudio'}
          </Button>
          {/* Último en el código: en celular (columna invertida) queda arriba de los botones; en escritorio, a la izquierda. */}
          {blocked && (
            <p id="import-blocked" className="text-xs text-muted-foreground sm:order-first sm:mr-auto" role="status">
              {blocked}
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Grabar el camino correcto ────────────────────────────────────────────

export function RecordPanel({
  steps,
  kind,
  screens,
  onRestart,
  onCancel,
  onUse,
}: {
  steps: readonly DemoStep[];
  kind: 'task' | 'first-click';
  screens: readonly ScreenInfo[];
  onRestart: () => void;
  onCancel: () => void;
  onUse: (result: { startPath: string; expectedPath: string[]; success: SuccessRule }) => void;
}) {
  const result = demoResult(steps, kind);
  const [choice, setChoice] = useState<'reached' | 'tapped' | null>(null);
  const picked = result ? (choice && result[choice] ? choice : result.suggested) : null;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [steps.length]);

  const use = (): void => {
    if (!result || !picked) return;
    const success = picked === 'tapped' ? result.tapped?.rule : result.reached;
    if (!success) return;
    onUse({ startPath: result.startPath, expectedPath: result.expectedPath, success });
  };

  return (
    <div className="space-y-3 rounded-xl border border-red-500/40 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <p className="text-sm font-semibold">{kind === 'first-click' ? 'Mostrando el toque correcto' : 'Grabando el camino correcto'}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {kind === 'first-click' ? 'Toca en el teléfono el elemento correcto. Solo cuenta tu primer toque.' : 'Haz la tarea en el teléfono como la haría alguien que ya conoce el prototipo. Cada pantalla y cada toque aparecen aquí.'}
      </p>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esperando al prototipo…</p>
      ) : (
        <ol ref={list} className="max-h-44 space-y-1 overflow-y-auto text-sm" aria-live="polite" aria-label="Lo que has hecho">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              {s.type === 'screen' ? (
                <>
                  <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    Pantalla <span className="font-medium">{nameScreen(s.screen, screens)}</span> <span className="font-mono text-xs break-all text-muted-foreground">{s.screen}</span>
                  </span>
                </>
              ) : (
                <>
                  <Hand className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 text-muted-foreground">
                    Toque en {s.text ? <span className="text-foreground">"{s.text.slice(0, 40)}"</span> : <span className="font-mono text-xs break-all">{s.selector}</span>}
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {result && result.reached && result.tapped && (
        <fieldset className="space-y-1.5 border-t pt-3 text-sm">
          <legend className="sr-only">¿Cuándo se cumple la tarea?</legend>
          <p className="text-xs font-medium text-muted-foreground">La tarea se cumple cuando el participante…</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="demo-rule" className="mt-0.5 size-4 accent-[var(--primary)]" checked={picked === 'reached'} onChange={() => setChoice('reached')} />
            <span>
              llega a la pantalla <ScreenName id={(result.reached as Extract<SuccessRule, { type: 'reached' }>).path} screens={screens} className="font-medium" />
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="demo-rule" className="mt-0.5 size-4 accent-[var(--primary)]" checked={picked === 'tapped'} onChange={() => setChoice('tapped')} />
            <span>
              toca {kind === 'first-click' ? 'el elemento' : 'el último elemento'} {result.tapped.text ? <span className="font-medium">"{result.tapped.text.slice(0, 40)}"</span> : <span className="font-mono text-xs">{(result.tapped.rule as Extract<SuccessRule, { type: 'tapped' }>).selector}</span>}
            </span>
          </label>
        </fieldset>
      )}
      {result && !(result.reached && result.tapped) && (
        <p className="border-t pt-3 text-sm">
          {picked === 'tapped' ? (
            <>
              Se cumplirá al tocar {result.tapped?.text ? <span className="font-medium">"{result.tapped.text.slice(0, 40)}"</span> : 'ese elemento'}.
            </>
          ) : (
            <>
              Se cumplirá al llegar a <ScreenName id={(result.reached as Extract<SuccessRule, { type: 'reached' }>).path} screens={screens} className="font-medium" />.
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!result} onClick={use}>
          <Check /> Usar este camino
        </Button>
        <Button size="sm" variant="outline" onClick={onRestart}>
          <RotateCcw /> Reiniciar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {!result && steps.length > 0 && <p className="text-xs text-muted-foreground">{kind === 'first-click' ? 'Toca un elemento para poder usarlo.' : 'Navega a otra pantalla o toca algo para poder usar el camino.'}</p>}
    </div>
  );
}
