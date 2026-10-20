'use client';
import { useEffect, useRef } from 'react';
import { usePreferences } from './preferences';

// Native modal supplies inert background, focus containment, and a mobile sheet.
export function Dialog({
  titleId,
  descriptionId,
  onClose,
  children,
}: {
  titleId: string;
  descriptionId?: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = usePreferences();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    const title = document.getElementById(titleId);
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
    return () => {
      dialog.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous !== document.body
      )
        previous.focus();
      else document.querySelector<HTMLElement>('#main')?.focus();
    };
  }, [titleId]);
  return (
    <dialog
      ref={ref}
      className="dialog-sheet"
      closedby={onClose ? 'closerequest' : 'none'}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDownCapture={(event) => {
        if (!onClose && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClose={() => {
        const dialog = ref.current;
        // A mandatory warning must not be stranded when the platform closes
        // the native dialog without unmounting its React warning state.
        if (!onClose && dialog?.isConnected && !dialog.open) {
          dialog.showModal();
          document.getElementById(titleId)?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          ref.current!.querySelectorAll<HTMLElement>(
            'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === document.getElementById(titleId))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
    >
      {onClose ? (
        <button type="button" className="dialog-close" onClick={onClose}>
          {t('Close')}
        </button>
      ) : null}
      {children}
    </dialog>
  );
}
