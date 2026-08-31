/**
 * The one popover in the shell.
 *
 * Two callers — the agent-access dot and the Save menu — and no library. The anchor and the
 * panel are siblings inside a `position: relative` wrapper, so the card needs no measurement
 * and no reflow listener; CSS alone places it. This class owns only the OPEN state: the
 * `aria-expanded` on the anchor, the `hidden` on the panel, and the two ways out (a click
 * outside, or Escape).
 *
 * One at a time: opening one closes the other, so two cards can never overlap.
 */
export class Popover {
  private static open: Popover | null = null;

  constructor(
    private readonly anchor: HTMLElement,
    private readonly panel: HTMLElement
  ) {
    anchor.addEventListener('click', () => this.toggle());
  }

  isOpen(): boolean {
    return Popover.open === this;
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.show();
  }

  show(): void {
    Popover.open?.close();
    Popover.open = this;
    this.panel.hidden = false;
    this.anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', Popover.onDocumentClick, true);
    document.addEventListener('keydown', Popover.onKeydown, true);
  }

  close(): void {
    this.panel.hidden = true;
    this.anchor.setAttribute('aria-expanded', 'false');
    if (Popover.open === this) {
      Popover.open = null;
      document.removeEventListener('click', Popover.onDocumentClick, true);
      document.removeEventListener('keydown', Popover.onKeydown, true);
    }
  }

  /* Capture, and decided by CONTAINMENT rather than by stopPropagation.
     The first version stopped propagation on the anchor instead, and a second click on the same
     button could never close the card: the capture listener closed it first, and the anchor's
     own toggle then found it shut and re-opened it. Asking where the click landed has no such
     ordering problem, and it leaves the panel's own buttons (Save as…, Download last save) free
     to run — each closes the card itself when it acts. */
  private static readonly onDocumentClick = (ev: MouseEvent): void => {
    const open = Popover.open;
    if (!open) return;
    const target = ev.target as Node | null;
    if (target && (open.anchor.contains(target) || open.panel.contains(target))) return;
    open.close();
  };

  private static readonly onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    const open = Popover.open;
    if (!open) return;
    open.close();
    open.anchor.focus(); // Escape returns the keyboard to the control that opened the card
  };
}
