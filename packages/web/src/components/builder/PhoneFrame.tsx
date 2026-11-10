/**
 * El teléfono del constructor: el prototipo en un iframe del mismo origen. El nombre de la
 * ventana le dice al recorder en qué modo está (observar, probar) y sobrevive a la navegación.
 * Los mensajes del recorder se validan (vienen de este iframe y tienen la forma esperada).
 */
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { DEMO_WINDOW, isRecorderMessage, screenLabel, type PanelMessage, type Prototype, type RecorderMessage } from '@taptana/shared';
import { Hint } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { prototypeFrameUrl } from '@/lib/links';
import { cn } from '@/lib/utils';

export interface PhoneHandle {
  /** Vuelve a cargar la pantalla de inicio. */
  reload(): void;
  /** Cuántos elementos de la pantalla actual coinciden con el selector; null si no se puede saber. */
  countMatches(selector: string): number | null;
  /** Manda un mensaje al recorder del iframe. */
  post(message: PanelMessage): void;
}

export function PhoneFrame({
  proto,
  screen,
  windowName = DEMO_WINDOW,
  onMessage,
  ref,
  banner,
  highlight = false,
  className,
}: {
  proto: Prototype | undefined;
  /** ScreenId donde abrir; sin él, la entrada del prototipo. */
  screen?: string | undefined;
  windowName?: string;
  onMessage?: (message: RecorderMessage) => void;
  ref?: Ref<PhoneHandle>;
  /** Aviso sobre el teléfono (modo grabar, elegir elemento). */
  banner?: ReactNode;
  highlight?: boolean;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);
  const [current, setCurrent] = useState<{ screen: string; title: string } | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  const src = proto ? prototypeFrameUrl(proto, screen ? { screen } : {}) : null;

  useEffect(() => {
    setCurrent(null);
  }, [src, nonce]);

  useEffect(() => {
    const onWindowMessage = (e: MessageEvent): void => {
      if (!frame.current || e.source !== frame.current.contentWindow || !isRecorderMessage(e.data)) return;
      const msg = e.data;
      if (msg.type === 'ready' || msg.type === 'screen') setCurrent({ screen: msg.screen, title: msg.title });
      handler.current?.(msg);
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reload: () => setNonce((n) => n + 1),
      countMatches(selector) {
        try {
          const doc = frame.current?.contentDocument;
          if (!doc || !selector.trim()) return null;
          return doc.querySelectorAll(selector).length;
        } catch {
          // Selector mal escrito, o el iframe aún no carga.
          return null;
        }
      },
      post(message) {
        frame.current?.contentWindow?.postMessage(message, location.origin);
      },
    }),
    [],
  );

  const tabUrl = proto ? prototypeFrameUrl(proto, { ...(current ? { screen: current.screen } : screen ? { screen } : {}), preview: true }) : null;

  return (
    <div className={cn('mx-auto w-full max-w-[390px] space-y-2', className)}>
      <div className="flex items-center gap-1 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={current?.screen}>
          {current ? (
            <>
              Pantalla: <span className="font-medium text-foreground">{current.title || screenLabel(current.screen)}</span>
            </>
          ) : proto ? (
            'Cargando el prototipo…'
          ) : (
            'Sin prototipo'
          )}
        </span>
        <Hint label="Volver a cargar desde el inicio">
          <Button type="button" variant="ghost" size="icon" aria-label="Volver a cargar el prototipo" disabled={!proto} onClick={() => setNonce((n) => n + 1)}>
            <RotateCw />
          </Button>
        </Hint>
        <Hint label="Abrir en una pestaña nueva (no se graba)">
          <Button variant="ghost" size="icon" asChild={Boolean(tabUrl)} aria-label="Abrir el prototipo en una pestaña nueva" disabled={!tabUrl}>
            {tabUrl ? (
              <a href={tabUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            ) : (
              <ExternalLink />
            )}
          </Button>
        </Hint>
      </div>
      {banner}
      <div className={cn('overflow-hidden rounded-[2rem] border-[6px] border-foreground/85 bg-background shadow-lg transition-shadow', highlight && 'ring-4 ring-primary/40')}>
        {src ? (
          <iframe
            key={`${src}#${nonce}`}
            ref={frame}
            name={windowName}
            src={src}
            title="Prototipo en el teléfono"
            className="block h-[min(680px,calc(100dvh-13rem))] min-h-[460px] w-full bg-white"
          />
        ) : (
          <div className="grid h-[460px] place-items-center px-6 text-center text-sm text-muted-foreground">Elige un prototipo en "Ajustes del estudio" para verlo aquí.</div>
        )}
      </div>
    </div>
  );
}
