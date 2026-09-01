/**
 * Messages to the human, bottom-left over the stage.
 *
 * Replaces the status-bar pill: a pill that is always on screen has to be read to find out
 * whether it changed, and it had nowhere to put a message that MUST be acted on. A toast
 * arrives, is read, and leaves — except an error, which stays until it is dismissed by hand.
 *
 * A dismissed info toast is HIDDEN, not removed: the newest message stays readable to
 * assistive tech and to anything asking the page what it last said. Nodes are pruned only
 * when a newer toast pushes them past the stack cap.
 */
const MAX_TOASTS = 3;
const DISMISS_MS = 5000;

export class Toasts {
  constructor(private readonly host: HTMLElement) {}

  show(text: string, bad = false): void {
    const toast = document.createElement('div');
    toast.className = bad ? 'toast bad' : 'toast';
    toast.setAttribute('data-testid', 'toast');

    const body = document.createElement('span');
    body.className = 'toast-text';
    body.textContent = text;
    toast.append(body);

    if (bad) {
      // Errors are sticky. An agent's save that failed must not scroll past unread.
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-close';
      close.setAttribute('aria-label', 'Dismiss');
      close.setAttribute('data-testid', 'toast-dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => toast.remove());
      toast.append(close);
    } else {
      setTimeout(() => {
        toast.hidden = true;
      }, DISMISS_MS);
    }

    // `app-message` names the message the page is showing NOW — exactly one element ever
    // carries it, so a reader (human or test) has one place to look.
    for (const older of this.host.querySelectorAll('[data-testid="app-message"]')) {
      older.setAttribute('data-testid', 'toast');
    }
    toast.setAttribute('data-testid', 'app-message');

    this.host.append(toast);
    while (this.host.children.length > MAX_TOASTS) this.host.firstElementChild!.remove();
  }
}
