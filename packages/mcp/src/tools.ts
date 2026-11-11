/**
 * Las herramientas del MCP. Cada una llama a la API de Taptana y devuelve texto pensado para un
 * modelo: qué encontró y qué hacer después. No hay herramientas para borrar, y nunca se
 * entregan grabaciones ni eventos de rrweb.
 */

import {
  API_PREFIX,
  PANEL_PATH,
  STUDY_PARAM,
  TRYOUT_PARAM,
  sameScreen,
  taskBlocks,
  validateStudy,
  type Prototype,
  type ScreenInfo,
  type ServerInfo,
  type SessionSummary,
  type Study,
  type StudyIssue,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import { apiError, FriendlyError, type ApiRequest, type ApiResponse } from './api.js';
import { studyFormatGuide } from './guide.js';
import { summarizeReport } from './summary.js';

export interface ToolContext {
  request: ApiRequest;
  /** Dónde abre el diseñador el panel ("http://localhost:4321"). Si falta, se deduce de /info. */
  panelUrl?: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations: ToolAnnotations;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export const LOCKED_HINT =
  'Taptana pidió la llave del panel. Si usas el comando (stdio), pon la llave en la variable TAPTANA_KEY; si usas la dirección (URL), mándala en la cabecera «Authorization: Bearer <llave>». La llave es lo que va después de «key=» en el link «Panel desde otro dispositivo» que muestra Taptana al arrancar.';

// ── Ayudas ───────────────────────────────────────────────────────────────

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const fail = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }], isError: true });
/** Una frase para el modelo y después los datos en JSON. */
const answer = (lead: string, data: unknown): ToolResult => text(`${lead}\n\n${JSON.stringify(data, null, 2)}`);
const failWith = (lead: string, data: unknown): ToolResult => fail(`${lead}\n\n${JSON.stringify(data, null, 2)}`);

async function call(ctx: ToolContext, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await ctx.request(method, `${API_PREFIX}${path}`, body);
  if (res.status === 401) throw new FriendlyError(LOCKED_HINT);
  return res;
}

async function get<T>(ctx: ToolContext, path: string, what: string): Promise<T> {
  const res = await call(ctx, 'GET', path);
  if (res.status < 200 || res.status >= 300) throw new FriendlyError(apiError(res, `No pude leer ${what}`));
  return res.data as T;
}

const enc = encodeURIComponent;

function stringArg(args: Record<string, unknown>, name: string, required: true): string;
function stringArg(args: Record<string, unknown>, name: string, required?: false): string | undefined;
function stringArg(args: Record<string, unknown>, name: string, required = false): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new FriendlyError(`Falta el argumento «${name}».`);
    return undefined;
  }
  if (typeof value !== 'string') throw new FriendlyError(`El argumento «${name}» tiene que ser un texto.`);
  return value.trim();
}

/** El estudio puede llegar como objeto o como texto JSON (algunos modelos lo mandan así). */
function studyArg(args: Record<string, unknown>): unknown {
  const value = args['study'];
  if (value === undefined || value === null) throw new FriendlyError('Falta el argumento «study» con el estudio en formato v2.');
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new FriendlyError('«study» no es JSON válido. Mándalo como objeto, sin comentarios ni bloque de código.');
    }
  }
  return value;
}

interface Links {
  info: Partial<ServerInfo>;
  panel: string;
}

async function links(ctx: ToolContext): Promise<Links> {
  const info = await get<Partial<ServerInfo>>(ctx, '/info', 'los datos del servidor');
  const base = ctx.panelUrl ?? info.participantUrl ?? 'http://localhost:4321/';
  return { info, panel: new URL(PANEL_PATH, base).toString() };
}

async function prototypes(ctx: ToolContext): Promise<Prototype[]> {
  return (await get<{ prototypes: Prototype[] }>(ctx, '/prototypes', 'los prototipos')).prototypes;
}

/** Links de un estudio: editarlo, probarlo sin grabar, compartirlo y ver el reporte. */
function studyLinks(l: Links, study: { id: string; prototypeId: string }, protos: Prototype[]) {
  const proto = protos.find((p) => p.id === study.prototypeId);
  const out: Record<string, string> = {
    edit: `${l.panel}/studies/${enc(study.id)}`,
    report: `${l.panel}/studies/${enc(study.id)}/report`,
  };
  if (proto?.url && l.info.participantUrl) {
    const share = new URL(proto.url, l.info.participantUrl);
    share.searchParams.set(STUDY_PARAM, study.id);
    out['share'] = share.toString();
    share.searchParams.set(TRYOUT_PARAM, '1');
    out['tryout'] = share.toString();
  }
  return out;
}

const LINKS_NOTE =
  'tryout abre el estudio completo sin grabar nada (para que el diseñador lo pruebe). share es el link para participantes: se abre en el celular, en la misma Wi-Fi. edit abre el constructor en el panel.';

async function sessionsOf(ctx: ToolContext, studyId: string): Promise<SessionSummary[]> {
  return (await get<{ sessions: SessionSummary[] }>(ctx, `/sessions?study=${enc(studyId)}`, 'las sesiones')).sessions;
}

const issueOut = (i: StudyIssue) => ({ message: i.message, ...(i.blockId && { blockId: i.blockId }), ...(i.field && { field: i.field }) });

interface Checked {
  ok: boolean;
  errors: Array<ReturnType<typeof issueOut>>;
  warnings: Array<ReturnType<typeof issueOut>>;
  study?: Study;
}

/**
 * La misma validación que el panel (`validateStudy`), más dos revisiones que solo se pueden
 * hacer con el servidor: que el prototipo exista y que las pantallas nombradas sean conocidas.
 */
async function check(ctx: ToolContext, raw: unknown): Promise<Checked> {
  const result = validateStudy(raw);
  const errors = result.issues.filter((i) => i.level !== 'warn').map(issueOut);
  const warnings = result.issues.filter((i) => i.level === 'warn').map(issueOut);
  if (!result.ok) return { ok: false, errors, warnings };
  const study = result.value;

  const protos = await prototypes(ctx);
  if (!protos.some((p) => p.id === study.prototypeId)) {
    const known = protos.map((p) => `${p.id} (${p.name})`).join(', ') || 'ninguno todavía';
    errors.push({ message: `El prototipo «${study.prototypeId}» no existe en este Taptana. Usa uno de list_prototypes: ${known}.`, field: 'prototypeId' });
    return { ok: false, errors, warnings, study };
  }

  const { screens } = await get<{ screens: ScreenInfo[] }>(ctx, `/prototypes/${enc(study.prototypeId)}/screens`, 'las pantallas');
  if (screens.length > 0) {
    const known = (id: string): boolean => screens.some((s) => sameScreen(s.id, id));
    const unknown = (id: string | undefined, blockId: string | undefined, field: string, where: string): void => {
      if (id && !known(id)) {
        warnings.push({
          message: `${where} nombra la pantalla «${id}», que no está entre las pantallas conocidas del prototipo. Usa una de list_screens o confirma que existe.`,
          ...(blockId && { blockId }),
          field,
        });
      }
    };
    for (const block of taskBlocks(study)) {
      const where = `El bloque «${block.id}»`;
      unknown(block.startPath, block.id, 'startPath', where);
      if (block.success.type === 'reached') unknown(block.success.path, block.id, 'success.path', where);
      for (const step of block.expectedPath ?? []) unknown(step, block.id, 'expectedPath', where);
    }
    for (const variant of study.variants ?? []) unknown(variant.startPath, undefined, 'variants', `La variante «${variant.id}»`);
  } else {
    warnings.push({ message: 'Este prototipo todavía no tiene pantallas conocidas, así que no se pudieron revisar las pantallas del estudio.', field: 'blocks' });
  }
  return { ok: errors.length === 0, errors, warnings, study };
}

// ── Las herramientas ─────────────────────────────────────────────────────

const STUDY_SCHEMA = {
  type: 'object',
  description: 'El estudio en formato v2 (ver get_study_format): { v: 2, name, prototypeId, welcome?, consent?, thanks?, settings?, variants?, blocks: [...] }.',
  additionalProperties: true,
};
const STUDY_ID = { type: 'string', description: 'El id del estudio ("st_…"), de list_studies.' };

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_info',
    title: 'Datos de Taptana',
    description:
      'Versión de Taptana, dirección del panel y cómo se ven los links para compartir un estudio. Úsala si necesitas saber a qué Taptana estás conectado o para explicarle al diseñador dónde abrir el panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (_args, ctx) => {
      const l = await links(ctx);
      const base = l.info.participantUrl;
      return answer('Datos del Taptana conectado.', {
        name: 'Taptana',
        version: l.info.version ?? null,
        panelUrl: l.panel,
        participantBaseUrl: base ?? null,
        shareLinkFormat: base ? `${base}p/<prototypeId>/?study=<studyId>` : null,
        tryoutLinkFormat: base ? `${base}p/<prototypeId>/?study=<studyId>&tryout=1` : null,
        note: 'Los links exactos de cada estudio salen en create_study y get_study. El participante abre el suyo en el celular, conectado a la misma Wi-Fi que esta computadora.',
      });
    },
  },
  {
    name: 'get_study_format',
    title: 'Guía del formato de estudio',
    description:
      'La guía completa para escribir un estudio de Taptana: tipos de bloque, reglas de éxito, identificadores de pantalla, ejemplo y consejos para buenas tareas. Llámala SIEMPRE antes de escribir o cambiar un estudio. Después: list_prototypes y list_screens.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => text(studyFormatGuide()),
  },
  {
    name: 'list_prototypes',
    title: 'Prototipos',
    description:
      'Los prototipos cargados en Taptana, con su id y nombre. El id es el prototypeId del estudio. Después llama a list_screens con el id elegido. Si no hay ninguno, el diseñador puede subir uno en el panel (Prototipos) o puedes usar upload_prototype.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (_args, ctx) => {
      const list = await prototypes(ctx);
      if (list.length === 0) return text('Todavía no hay prototipos. El diseñador puede subir un .html o .zip en el panel (Prototipos), o cargar el ejemplo con «Ver un ejemplo» en Inicio.');
      return answer(
        `Hay ${list.length === 1 ? '1 prototipo' : `${list.length} prototipos`}. Usa su id como prototypeId y pide sus pantallas con list_screens.`,
        list.map((p) => ({ id: p.id, name: p.name, ...(p.url && { url: p.url }) })),
      );
    },
  },
  {
    name: 'list_screens',
    title: 'Pantallas de un prototipo',
    description:
      'Las pantallas conocidas de un prototipo: id de pantalla (por ejemplo "/producto.html", "/index.html#/carrito" o "/index.html~checkout") y nombre. Usa SOLO estos ids en startPath, success.path y expectedPath; nunca inventes pantallas.',
    inputSchema: {
      type: 'object',
      properties: { prototypeId: { type: 'string', description: 'El id del prototipo, de list_prototypes.' } },
      required: ['prototypeId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const id = stringArg(args, 'prototypeId', true);
      const list = await prototypes(ctx);
      if (!list.some((p) => p.id === id)) return fail(`No existe el prototipo «${id}». Llama a list_prototypes para ver los que hay.`);
      const { screens } = await get<{ screens: ScreenInfo[] }>(ctx, `/prototypes/${enc(id)}/screens`, 'las pantallas');
      if (screens.length === 0) {
        return text('Este prototipo no tiene pantallas conocidas todavía (no se encontraron páginas HTML). Pide al diseñador el HTML o usa reglas "visible" o "manual".');
      }
      return answer(
        `${screens.length === 1 ? '1 pantalla' : `${screens.length} pantallas`}. "file" es un archivo HTML del prototipo; "seen" es una pantalla vista en alguna sesión (por ejemplo una ruta de una app de una página).`,
        screens.map((s) => ({ id: s.id, name: s.name ?? s.label, source: s.source })),
      );
    },
  },
  {
    name: 'list_studies',
    title: 'Estudios',
    description: 'Los estudios guardados, con cuántos bloques, tareas y sesiones tiene cada uno. Opcional: solo los de un prototipo. Para ver uno completo, get_study; para sus resultados, get_report.',
    inputSchema: {
      type: 'object',
      properties: { prototypeId: { type: 'string', description: 'Solo los estudios de este prototipo.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const protoId = stringArg(args, 'prototypeId');
      const { studies } = await get<{ studies: StudyRecord[] }>(ctx, `/studies${protoId ? `?prototype=${enc(protoId)}` : ''}`, 'los estudios');
      if (studies.length === 0) return text('No hay estudios todavía. Para crear uno: get_study_format, list_prototypes, list_screens y create_study.');
      const { sessions } = await get<{ sessions: SessionSummary[] }>(ctx, '/sessions', 'las sesiones');
      return answer(
        `${studies.length === 1 ? '1 estudio' : `${studies.length} estudios`}.`,
        studies.map((s) => ({
          id: s.id,
          name: s.name,
          prototypeId: s.prototypeId,
          blocks: s.blocks.length,
          tasks: taskBlocks(s).length,
          sessions: sessions.filter((x) => x.studyId === s.id).length,
          closed: s.closed === true,
          updatedAt: new Date(s.updatedAt).toISOString(),
        })),
      );
    },
  },
  {
    name: 'get_study',
    title: 'Ver un estudio',
    description: 'Un estudio completo en formato v2, con sus links (editar, probar sin grabar, compartir, reporte) y cuántas sesiones tiene. Úsalo antes de update_study para partir de lo que ya hay.',
    inputSchema: { type: 'object', properties: { studyId: STUDY_ID }, required: ['studyId'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const id = stringArg(args, 'studyId', true);
      const study = await get<StudyRecord>(ctx, `/studies/${enc(id)}`, 'el estudio');
      const [l, protos, sessions] = await Promise.all([links(ctx), prototypes(ctx), sessionsOf(ctx, id)]);
      return answer(`Estudio «${study.name}». ${sessions.length === 0 ? 'Todavía no tiene sesiones.' : `Tiene ${sessions.length} sesiones: cambiarlo afecta sus resultados, mejor duplícalo.`}`, {
        study,
        sessions: sessions.length,
        links: studyLinks(l, study, protos),
        linksNote: LINKS_NOTE,
      });
    },
  },
  {
    name: 'validate_study',
    title: 'Revisar un estudio',
    description:
      'Revisa un estudio sin guardarlo, con la misma validación del panel. Devuelve errores (impiden guardar), avisos (no impiden, pero léelos) y el estudio normalizado. También avisa si una regla o pantalla de inicio nombra una pantalla que el prototipo no tiene. Corrige y vuelve a validar hasta que no haya errores; después, create_study.',
    inputSchema: { type: 'object', properties: { study: STUDY_SCHEMA }, required: ['study'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const result = await check(ctx, studyArg(args));
      const lead = result.ok
        ? result.warnings.length > 0
          ? `El estudio es válido, con ${result.warnings.length === 1 ? '1 aviso' : `${result.warnings.length} avisos`}. Revísalos y, si está bien, guárdalo con create_study.`
          : 'El estudio es válido. Guárdalo con create_study.'
        : `El estudio tiene ${result.errors.length === 1 ? '1 error' : `${result.errors.length} errores`}. Corrígelos y vuelve a validar.`;
      return answer(lead, result);
    },
  },
  {
    name: 'create_study',
    title: 'Guardar un estudio nuevo',
    description:
      'Valida y guarda un estudio nuevo. Devuelve su id y los links: edit (el constructor en el panel), tryout (probarlo sin grabar) y share (para participantes). Si tiene errores no guarda nada y los devuelve. Al terminar, dale al diseñador el link tryout y pídele que lo revise en el panel antes de compartir.',
    inputSchema: { type: 'object', properties: { study: STUDY_SCHEMA }, required: ['study'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      const result = await check(ctx, studyArg(args));
      if (!result.ok || !result.study) return failWith('No guardé el estudio: tiene errores. Corrígelos (puedes usar validate_study) y vuelve a intentarlo.', result);
      const res = await call(ctx, 'POST', '/studies', result.study);
      if (res.status !== 201 && res.status !== 200) return failWith(`No se pudo guardar: ${apiError(res, 'error al guardar')}`, res.data);
      const saved = res.data as StudyRecord;
      const [l, protos] = await Promise.all([links(ctx), prototypes(ctx)]);
      return answer(`Guardé el estudio «${saved.name}» (${saved.id}). Dale al diseñador el link tryout para probarlo sin grabar.`, {
        id: saved.id,
        links: studyLinks(l, saved, protos),
        linksNote: LINKS_NOTE,
        warnings: result.warnings,
      });
    },
  },
  {
    name: 'update_study',
    title: 'Reemplazar un estudio',
    description:
      'Reemplaza un estudio guardado por la versión que mandas (completa, no solo los cambios: parte de get_study). Si el estudio ya tiene sesiones, no lo cambia salvo que pases confirm: true; en ese caso es mejor duplicate_study y editar la copia, porque cambiar bloques afecta los resultados ya grabados.',
    inputSchema: {
      type: 'object',
      properties: {
        studyId: STUDY_ID,
        study: STUDY_SCHEMA,
        confirm: { type: 'boolean', description: 'true para cambiarlo aunque ya tenga sesiones. Solo si el diseñador lo pidió.' },
      },
      required: ['studyId', 'study'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const id = stringArg(args, 'studyId', true);
      const current = await get<StudyRecord>(ctx, `/studies/${enc(id)}`, 'el estudio');
      const sessions = await sessionsOf(ctx, id);
      if (sessions.length > 0 && args['confirm'] !== true) {
        return fail(
          `El estudio «${current.name}» ya tiene ${sessions.length === 1 ? '1 sesión' : `${sessions.length} sesiones`}: cambiarlo puede desordenar sus resultados. Mejor usa duplicate_study y cambia la copia. Si el diseñador igual quiere cambiar este, vuelve a llamar con confirm: true.`,
        );
      }
      let raw = studyArg(args);
      // Si no trae prototipo, sigue con el de antes.
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('prototypeId' in raw)) raw = { ...raw, prototypeId: current.prototypeId };
      const result = await check(ctx, raw);
      if (!result.ok || !result.study) return failWith('No cambié el estudio: tiene errores. Corrígelos y vuelve a intentarlo.', result);
      const res = await call(ctx, 'PUT', `/studies/${enc(id)}`, result.study);
      if (res.status !== 200) return failWith(`No se pudo guardar: ${apiError(res, 'error al guardar')}`, res.data);
      const saved = res.data as StudyRecord;
      const [l, protos] = await Promise.all([links(ctx), prototypes(ctx)]);
      return answer(`Actualicé el estudio «${saved.name}» (${saved.id}).`, { id: saved.id, links: studyLinks(l, saved, protos), linksNote: LINKS_NOTE, warnings: result.warnings });
    },
  },
  {
    name: 'duplicate_study',
    title: 'Duplicar un estudio',
    description: 'Crea una copia ("Copia de …") de un estudio, sin sus sesiones. Úsala para cambiar un estudio que ya tiene sesiones: duplica y después update_study sobre la copia.',
    inputSchema: { type: 'object', properties: { studyId: STUDY_ID }, required: ['studyId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      const id = stringArg(args, 'studyId', true);
      const res = await call(ctx, 'POST', `/studies/${enc(id)}/duplicate`);
      if (res.status !== 201) return fail(apiError(res, 'No se pudo duplicar el estudio'));
      const copy = res.data as StudyRecord;
      const [l, protos] = await Promise.all([links(ctx), prototypes(ctx)]);
      return answer(`Creé «${copy.name}» (${copy.id}). Puedes cambiarla con update_study.`, { id: copy.id, links: studyLinks(l, copy, protos), linksNote: LINKS_NOTE });
    },
  },
  {
    name: 'get_report',
    title: 'Reporte de un estudio',
    description:
      'Resumen de los resultados de un estudio: puntaje de usabilidad (0–100), éxito por tarea, dónde se pierde la gente (embudo), toques sin efecto, frases de "qué arreglar" y las respuestas a las preguntas (incluidas las abiertas, sin nombres). No trae grabaciones. Úsalo para explicar los resultados al diseñador y proponer cambios concretos al prototipo.',
    inputSchema: {
      type: 'object',
      properties: {
        studyId: STUDY_ID,
        variant: { type: 'string', description: 'Solo una variante A/B (su id).' },
        device: { type: 'string', enum: ['touch', 'desktop'], description: '"touch": celulares y tablets. "desktop": computadoras.' },
      },
      required: ['studyId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args, ctx) => {
      const id = stringArg(args, 'studyId', true);
      const variant = stringArg(args, 'variant');
      const device = stringArg(args, 'device');
      const query = new URLSearchParams();
      if (variant) query.set('variant', variant);
      if (device) query.set('device', device);
      const qs = query.size > 0 ? `?${query}` : '';
      const study = await get<StudyRecord>(ctx, `/studies/${enc(id)}`, 'el estudio');
      const report = await get<StudyReport>(ctx, `/studies/${enc(id)}/report${qs}`, 'el reporte');
      const summary = summarizeReport(report, study);
      const lead =
        report.participants === 0
          ? `«${study.name}» todavía no tiene participantes. Comparte su link (get_study) y vuelve cuando alguien lo haya hecho.`
          : `Reporte de «${study.name}»: ${report.participants === 1 ? '1 participante' : `${report.participants} participantes`}, puntaje ${report.score ?? 'sin datos'}.`;
      return answer(lead, summary);
    },
  },
  {
    name: 'upload_prototype',
    title: 'Subir un prototipo',
    description:
      'Crea un prototipo nuevo a partir de un HTML de una sola página (con su CSS y JavaScript adentro). Úsala cuando acabas de escribir un prototipo y el diseñador quiere probarlo. Para prototipos con varios archivos, el diseñador sube un .zip en el panel. Después: list_screens con el id que devuelve.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre del prototipo, como lo verá el diseñador.' },
        html: { type: 'string', description: 'El HTML completo de la página.' },
      },
      required: ['name', 'html'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      const name = stringArg(args, 'name', true);
      const html = args['html'];
      if (typeof html !== 'string' || !html.trim()) return fail('Falta el argumento «html» con la página completa.');
      const form = new FormData();
      form.set('name', name);
      form.set('file', new File([html], 'index.html', { type: 'text/html' }));
      const res = await call(ctx, 'POST', '/prototypes', form);
      if (res.status !== 201) return fail(apiError(res, 'No se pudo subir el prototipo'));
      const proto = res.data as Prototype;
      const l = await links(ctx);
      return answer(`Subí el prototipo «${proto.name}» (${proto.id}). Ahora pide sus pantallas con list_screens.`, {
        id: proto.id,
        name: proto.name,
        panel: `${l.panel}/prototypes`,
        ...(proto.url && l.info.participantUrl && { open: new URL(proto.url, l.info.participantUrl).toString() }),
      });
    },
  },
];

/** Corre una herramienta y convierte cualquier problema en un resultado con `isError`. */
export async function runTool(tool: ToolDefinition, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    if (err instanceof FriendlyError) return fail(err.message);
    return fail(`Algo falló al usar ${tool.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
