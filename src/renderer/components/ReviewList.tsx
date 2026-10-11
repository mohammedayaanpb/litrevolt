import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, BookOpenCheck, Check, Folder, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import type { ReviewSummary } from '../../shared/types';
import { clearReviewDrafts } from '../local-drafts';
import { Badge, Button, IconButton, Spinner } from './ui';
import './ReviewList.css';

type Action = 'rename' | 'delete';
type MenuState = { review: ReviewSummary; x: number; y: number; trigger: HTMLElement };
type DialogState = { review: ReviewSummary; action: Action; trigger: HTMLElement };
type RenamePatch = Pick<ReviewSummary, 'name' | 'updatedAt'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function progressLabel(review: ReviewSummary): string {
  if (review.status === 'complete') return 'Complete';
  if (review.status === 'writing') return 'Writing';
  return `Pass ${review.currentPass} of 3`;
}

function updatedDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Shared review rows keep pointer, context-menu and keyboard actions consistent. */
export function ReviewList({ reviews, onOpen, onChanged, onEmptyFocus, notify, compact = false }: {
  reviews: ReviewSummary[];
  onOpen(id: string): void;
  onChanged(): Promise<unknown>;
  onEmptyFocus?(): void;
  notify(message: string, tone?: 'success' | 'error'): void;
  compact?: boolean;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Keep committed changes visible even if the follow-up library refresh fails.
  const [committed, setCommitted] = useState<Record<string, RenamePatch | null>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const visibleReviews = reviews.flatMap((review) => {
    if (!(review.id in committed)) return [review];
    const patch = committed[review.id];
    return patch ? [{ ...review, ...patch }] : [];
  });

  useEffect(() => {
    setCommitted((previous) => {
      const entries = Object.entries(previous).filter(([id, patch]) => {
        const incoming = reviews.find((review) => review.id === id);
        return patch ? incoming !== undefined && incoming.name !== patch.name : incoming !== undefined;
      });
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    });
  }, [reviews]);

  const restoreFocus = (trigger: HTMLElement, onlyIfFocusLost = false) => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // A delayed refresh can remove the focused row. Recover only orphaned
      // focus: the user may already have moved to another control while waiting.
      if (onlyIfFocusLost && active?.isConnected && active !== document.body) return;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else {
        const nextReview = listRef.current?.querySelector<HTMLButtonElement>('.review-entry-open');
        if (nextReview?.isConnected) nextReview.focus({ preventScroll: true });
        else if (onEmptyFocus) onEmptyFocus();
        else listRef.current?.focus({ preventScroll: true });
      }
    });
  };

  const openMenu = (review: ReviewSummary, row: HTMLElement, point?: { x: number; y: number }) => {
    const trigger = row.querySelector<HTMLButtonElement>('[data-review-actions]');
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    setMenu({ review, trigger, x: point?.x ?? bounds.left, y: point?.y ?? bounds.bottom + 5 });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, review: ReviewSummary) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    openMenu(review, event.currentTarget);
  };

  const finishMutation = (state: DialogState, updated?: ReviewSummary, draftsCleared = true) => {
    setCommitted((previous) => ({ ...previous, [state.review.id]: updated ? { name: updated.name, updatedAt: updated.updatedAt } : null }));
    setDialog(null);
    restoreFocus(state.trigger);
    const successMessage = updated ? 'Review name updated.' : 'Review deleted. Your paper and other reviews are still available.';
    notify(draftsCleared ? successMessage : 'Review deleted, but local draft recovery copies could not be cleared from this device.', draftsCleared ? 'success' : 'error');
    // The mutation has committed. A refresh error must never invite a second delete/save.
    void Promise.resolve().then(onChanged).catch((error: unknown) => {
      const cleanupMessage = draftsCleared ? '' : ' Local draft recovery copies also could not be cleared.';
      notify(`${updated ? 'Review name saved' : 'Review deleted'}, but the library could not refresh. ${errorMessage(error)}${cleanupMessage}`, 'error');
    }).finally(() => restoreFocus(state.trigger, true));
  };

  return <>
    <ul ref={listRef} className={`review-entries${compact ? ' review-entries-compact' : ''}`} aria-label="Reviews" tabIndex={-1}>
      {visibleReviews.map((review) => <li key={review.id} className="review-entry" onContextMenu={(event) => {
        event.preventDefault();
        openMenu(review, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
      }} onKeyDown={(event) => onRowKeyDown(event, review)}>
        <button type="button" className="review-entry-open" onClick={() => onOpen(review.id)} aria-label={`Open review: ${review.name}`}>
          <span className={`review-entry-icon${review.status === 'complete' ? ' is-complete' : ''}`} aria-hidden="true">{review.status === 'complete' ? <Check size={20} /> : <BookOpenCheck size={20} />}</span>
          <span className="review-entry-content">
            <span className="review-entry-title">{review.name}</span>
            {!compact && <span className="review-entry-paper">{review.paperTitle}</span>}
            <span className="review-entry-meta"><span className="review-entry-context"><Folder size={12} aria-hidden="true" />{review.projectName ?? 'General library'}</span><time dateTime={review.updatedAt}>Updated {updatedDate(review.updatedAt)}</time></span>
          </span>
          <span className="review-entry-progress"><Badge tone={review.status === 'complete' ? 'success' : review.status === 'writing' ? 'accent' : 'neutral'}>{progressLabel(review)}</Badge>{review.status === 'complete' && <span className="review-entry-score">{review.score}<span>/100</span></span>}</span>
          {!compact && <ArrowUpRight size={17} className="review-entry-arrow" aria-hidden="true" />}
        </button>
        <IconButton type="button" label={`More actions for ${review.name}`} className="review-entry-actions" data-review-actions="true" aria-haspopup="menu" aria-expanded={menu?.review.id === review.id} aria-controls={menu?.review.id === review.id ? menuId : undefined} onClick={(event) => {
          if (menu?.review.id === review.id) setMenu(null);
          else openMenu(review, event.currentTarget.parentElement!);
        }}><MoreHorizontal size={20} aria-hidden="true" /></IconButton>
      </li>)}
    </ul>
    {menu && <ReviewMenu id={menuId} state={menu} onDismiss={(focus) => { setMenu(null); if (focus) restoreFocus(menu.trigger); }} onSelect={(action) => {
      setDialog({ review: menu.review, action, trigger: menu.trigger });
      setMenu(null);
    }} />}
    {dialog && <ReviewActionDialog key={`${dialog.action}:${dialog.review.id}`} state={dialog} onDismiss={() => { setDialog(null); restoreFocus(dialog.trigger); }} onCommitted={(updated, draftsCleared) => finishMutation(dialog, updated, draftsCleared)} />}
  </>;
}

function ReviewMenu({ id, state, onDismiss, onSelect }: {
  id: string;
  state: MenuState;
  onDismiss(restoreFocus: boolean): void;
  onSelect(action: Action): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  // Event listeners use fresh callbacks without restarting and stealing menu focus.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(state.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(state.y, window.innerHeight - bounds.height - 8)) });
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [state]);

  useEffect(() => {
    const openingBounds = state.trigger.getBoundingClientRect();
    const openingScroll = { x: window.scrollX, y: window.scrollY };
    const pointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node) || state.trigger.contains(event.target as Node)) return;
      dismissRef.current(false);
    };
    const dismiss = () => dismissRef.current(true);
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      const currentBounds = state.trigger.getBoundingClientRect();
      // Browsers can deliver a queued scroll event after focus restoration even
      // when nothing moved. Dismiss only when the page or menu anchor moved.
      if (window.scrollX !== openingScroll.x || window.scrollY !== openingScroll.y
        || currentBounds.left !== openingBounds.left || currentBounds.top !== openingBounds.top) dismiss();
    };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [state.trigger]);

  return createPortal(<div ref={ref} id={id} className="review-context-menu" role="menu" aria-label={`Actions for ${state.review.name}`} style={position} onContextMenu={(event) => event.preventDefault()} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onDismiss(false);
  }} onKeyDown={(event) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onDismiss(true); }
  }}>
    <button type="button" role="menuitem" onClick={() => onSelect('rename')}><Pencil size={16} aria-hidden="true" />Edit review name</button>
    <button type="button" role="menuitem" className="review-context-delete" onClick={() => onSelect('delete')}><Trash2 size={16} aria-hidden="true" />Delete review</button>
  </div>, document.body);
}

function ReviewActionDialog({ state, onDismiss, onCommitted }: {
  state: DialogState;
  onDismiss(): void;
  onCommitted(updated?: ReviewSummary, draftsCleared?: boolean): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const [name, setName] = useState(state.review.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const deleting = state.action === 'delete';
  const trimmedName = name.trim();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    if (deleting) cancelRef.current?.focus();
    else { inputRef.current?.focus(); inputRef.current?.select(); }
    return () => { if (dialog.open) dialog.close(); };
  }, [deleting]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    if (!deleting && (trimmedName.length < 1 || trimmedName.length > 200)) {
      setError('Enter a review name between 1 and 200 characters.');
      inputRef.current?.focus();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError('');
    let updated: ReviewSummary | undefined;
    try {
      if (deleting) {
        await window.litrevolt.reviews.delete(state.review.id);
      } else {
        updated = await window.litrevolt.reviews.rename(state.review.id, trimmedName);
      }
    } catch (failure) {
      setError(`Could not ${deleting ? 'delete the review' : 'save the review name'}. ${errorMessage(failure)}`);
      pendingRef.current = false;
      setPending(false);
      return;
    }
    onCommitted(updated, deleting ? clearReviewDrafts(state.review.id) : true);
  };

  return createPortal(<dialog ref={dialogRef} className="review-action-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) onDismiss(); }} onClick={(event) => {
    if (event.target === event.currentTarget && !pendingRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }
  }}>
    <form onSubmit={(event) => void submit(event)} aria-busy={pending}>
      <div className="review-dialog-heading"><span className={`review-dialog-icon${deleting ? ' is-danger' : ''}`} aria-hidden="true">{deleting ? <Trash2 size={23} /> : <Pencil size={23} />}</span><IconButton type="button" label="Close dialog" disabled={pending} onClick={onDismiss}><X size={18} aria-hidden="true" /></IconButton></div>
      <h2 id={`${id}-title`}>{deleting ? 'Delete this review?' : 'Edit review name'}</h2>
      {deleting ? <>
        <p id={`${id}-description`}>Permanently delete <strong className="review-dialog-review-name">“{state.review.name}”</strong> and its notes, quiz answers, writing, scores, and review-specific highlights.</p>
        <p className="review-dialog-retained"><BookOpenCheck size={19} aria-hidden="true" /><span>Your source PDF and other reviews will stay in your library.</span></p>
        <p className="review-dialog-irreversible">This cannot be undone.</p>
      </> : <>
        <p id={`${id}-description`}>Give this review a name that makes it easy to find later.</p>
        <div className="field"><label className="field-label" htmlFor={`${id}-name`}>Review name</label><input ref={inputRef} id={`${id}-name`} value={name} maxLength={200} required disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-name-hint`} onChange={(event) => { setName(event.target.value); setError(''); }} /><span id={`${id}-name-hint`} className="field-hint">1–200 characters</span></div>
      </>}
      {error && <p id={`${id}-error`} className="form-error" role="alert">{error}</p>}
      <div className="review-dialog-actions"><button ref={cancelRef} type="button" className="button button-secondary" disabled={pending} onClick={onDismiss}>Cancel</button><Button type="submit" variant={deleting ? 'danger' : 'primary'} className={deleting ? 'review-delete-confirm' : ''} disabled={pending || (!deleting && (trimmedName.length < 1 || trimmedName.length > 200))}>{pending ? <Spinner label={deleting ? 'Deleting review' : 'Saving name'} /> : deleting ? 'Delete review' : 'Save name'}</Button></div>
    </form>
  </dialog>, document.body);
}
