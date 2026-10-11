import { useEffect, useId, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileText, Highlighter, Maximize2, MessageSquarePlus, Minimize2, Minus, Plus, Trash2 } from 'lucide-react';
import type { Annotation, AnnotationKind, HighlightRect } from '../../shared/types';
import { normalizeSelectedText, selectionRectsToPageRects } from '../pdf/highlight-geometry';
import { Button, IconButton, Spinner } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface SelectionMenu {
  x: number;
  y: number;
  page: number;
  text: string;
  quote: string;
  rects: HighlightRect[];
}

export function PdfViewer({ paperId, reviewId, page, onPage, notify }: {
  paperId: string;
  reviewId?: string;
  page: number;
  onPage(page: number): void;
  notify(message: string, tone?: 'success' | 'error'): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const annotationRequestRef = useRef(0);
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageDraft, setPageDraft] = useState(String(page));
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [containerWidth, setContainerWidth] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [compose, setCompose] = useState<AnnotationKind | null>(null);
  const [quote, setQuote] = useState('');
  const [content, setContent] = useState('');
  const [composePage, setComposePage] = useState(page);
  const [composeRects, setComposeRects] = useState<HighlightRect[]>([]);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [composerRevision, setComposerRevision] = useState(0);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [annotationsCollapsed, setAnnotationsCollapsed] = useState(false);
  const annotationPanelId = useId();

  const navigateToPage = (requestedPage: number) => {
    if (!document || !Number.isFinite(requestedPage)) return;
    const nextPage = Math.max(1, Math.min(document.numPages, Math.round(requestedPage)));
    setPageDraft(String(nextPage));
    if (nextPage !== page) onPage(nextPage);
  };

  const commitPageDraft = () => {
    const value = pageDraft.trim();
    if (!value) { setPageDraft(String(page)); return; }
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      setPageDraft(String(page));
      notify('Enter a whole page number.', 'error');
      return;
    }
    navigateToPage(Number(value));
  };

  const openComposer = (kind: AnnotationKind) => {
    if (savingAnnotation) return;
    if (compose !== kind) {
      setQuote('');
      setContent('');
      setComposeRects([]);
      setComposePage(page);
    }
    setAnnotationsCollapsed(false);
    setCompose(kind);
    setComposerRevision((value) => value + 1);
  };

  const closeComposer = () => {
    setCompose(null);
    setQuote('');
    setContent('');
    setComposeRects([]);
  };

  useEffect(() => {
    if (compose && !annotationsCollapsed) {
      // Keep the form visible even when the annotation list was scrolled down.
      composerRef.current?.parentElement?.scrollTo({ top: 0 });
    }
  }, [compose, annotationsCollapsed, composerRevision]);

  const loadAnnotations = async () => {
    const request = ++annotationRequestRef.current;
    try {
      const value = await window.litrevolt.reviews.listAnnotations(paperId, reviewId);
      if (request === annotationRequestRef.current) setAnnotations(value);
    } catch (error) {
      if (request === annotationRequestRef.current) notify(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setLoadError('');
    setDocument(null);
    setAnnotations([]);
    closeComposer();
    window.litrevolt.library.getPdfData(paperId).then((data) => {
      if (!active) return;
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
      return loadingTask.promise;
    }).then((value) => { if (active && value) setDocument(value); })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (active) { setLoadError(message); notify(message, 'error'); }
      })
      .finally(() => { if (active) setLoading(false); });
    void loadAnnotations();
    return () => { active = false; annotationRequestRef.current += 1; void loadingTask?.destroy(); };
  }, [paperId, reviewId]);

  useEffect(() => {
    if (!document || !canvasRef.current || !containerRef.current || !pageRef.current || !textLayerRef.current) return;
    let renderTask: pdfjs.RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    let cancelled = false;
    const pageElement = pageRef.current;
    const textElement = textLayerRef.current;
    textElement.replaceChildren();

    document.getPage(Math.max(1, Math.min(Number.isFinite(page) ? Math.round(page) : 1, document.numPages))).then(async (pdfPage) => {
      try {
        if (cancelled || !canvasRef.current || !containerRef.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const available = Math.max(400, containerRef.current.clientWidth - 48);
        const cssScale = (available / base.width) * zoom;
        const cssViewport = pdfPage.getViewport({ scale: cssScale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = pdfPage.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        pageElement.style.width = `${Math.floor(cssViewport.width)}px`;
        pageElement.style.height = `${Math.floor(cssViewport.height)}px`;
        pageElement.style.setProperty('--total-scale-factor', String(cssScale * pdfPage.userUnit));
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        textLayer = new pdfjs.TextLayer({
          textContentSource: pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
          container: textElement,
          viewport: cssViewport,
        });
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport: renderViewport });
        await Promise.all([renderTask.promise, textLayer.render()]);
      } finally {
        pdfPage.cleanup();
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (!(error instanceof Error && (error.name === 'RenderingCancelledException' || error.name === 'AbortException'))) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      textElement.replaceChildren();
    };
  }, [document, page, zoom, containerWidth]);

  useEffect(() => {
    if (!document) return;
    const validPage = Math.max(1, Math.min(Number.isFinite(page) ? Math.round(page) : 1, document.numPages));
    if (page !== validPage) onPage(validPage);
  }, [document, page, onPage]);

  useEffect(() => {
    setPageDraft(String(page));
    containerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [paperId, page]);

  useEffect(() => {
    setSelectionMenu(null);
  }, [paperId, reviewId, page, zoom, containerWidth, isFullscreen]);

  useEffect(() => {
    if (!selectionMenu) return;
    selectionMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!selectionMenuRef.current?.contains(event.target as Node)) setSelectionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectionMenu(null);
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [selectionMenu]);

  useEffect(() => {
    if (!isFullscreen) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setIsFullscreen(false);
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => window.removeEventListener('keydown', exitOnEscape);
  }, [isFullscreen]);

  const saveAnnotation = async () => {
    if (!compose || savingAnnotation) return;
    setSavingAnnotation(true);
    try {
      await window.litrevolt.reviews.saveAnnotation({
        paperId, reviewId: reviewId ?? null, page: composePage, kind: compose, content, quote,
        color: compose === 'highlight' ? '#F2C14E' : '#D65D3B', rects: compose === 'highlight' ? composeRects : [],
      });
      await loadAnnotations();
      closeComposer();
      window.getSelection()?.removeAllRanges();
      notify(compose === 'highlight' ? 'Highlight saved.' : 'Note saved.');
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setSavingAnnotation(false); }
  };

  const openSelectionMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const textLayer = textLayerRef.current;
    const pageElement = pageRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !textLayer || !pageElement) return;
    if (!selection.anchorNode || !selection.focusNode || !textLayer.contains(selection.anchorNode) || !textLayer.contains(selection.focusNode)) return;
    const selectedText = selection.toString();
    const quoteText = normalizeSelectedText(selectedText);
    const rects = selectionRectsToPageRects(pageElement.getBoundingClientRect(), selection.getRangeAt(0).getClientRects());
    if (!quoteText || rects.length === 0) return;
    event.preventDefault();
    setSelectionMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 202)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)),
      page, text: selectedText, quote: quoteText, rects,
    });
  };

  const copySelectedPassage = async () => {
    if (!selectionMenu) return;
    try {
      await navigator.clipboard.writeText(selectionMenu.text);
      setSelectionMenu(null);
      notify('Selected text copied.');
    } catch { notify('LitRevolt could not copy the selected text.', 'error'); }
  };

  const captureSelectedPassage = () => {
    if (!selectionMenu || savingAnnotation) return;
    if (selectionMenu.quote.length > 20_000) {
      notify('Select a shorter passage before creating a highlight.', 'error');
      return;
    }
    setQuote(selectionMenu.quote);
    setContent('');
    setComposeRects(selectionMenu.rects);
    setComposePage(selectionMenu.page);
    setCompose('highlight');
    setAnnotationsCollapsed(false);
    setComposerRevision((value) => value + 1);
    setSelectionMenu(null);
  };

  const pageAnnotations = annotations.filter((item) => item.page === page);
  return <section className={`pdf-viewer ${isFullscreen ? 'pdf-viewer-fullscreen' : ''}`} aria-label={isFullscreen ? 'Fullscreen PDF reader' : 'PDF reader'}>
    <header className="pdf-toolbar">
      <div className="pdf-toolbar-group" role="group" aria-label="PDF page navigation">
        <IconButton label="Previous page" disabled={!document || page <= 1} onClick={() => navigateToPage(page - 1)}><ChevronLeft size={18} /></IconButton>
        <label>Page <input
          type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Page number"
          title="Type a page number and press Enter" disabled={!document} value={pageDraft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setPageDraft(event.target.value)} onBlur={commitPageDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitPageDraft(); }
            if (event.key === 'Escape') { event.preventDefault(); setPageDraft(String(page)); }
          }}
        /> <span>of {document?.numPages ?? '…'}</span></label>
        <IconButton label="Next page" disabled={!document || page >= document.numPages} onClick={() => navigateToPage(page + 1)}><ChevronRight size={18} /></IconButton>
      </div>
      <div className="pdf-toolbar-group" role="group" aria-label="PDF zoom"><IconButton label="Zoom out" disabled={!document || zoom <= .65} onClick={() => setZoom(Math.max(.65, zoom - .15))}><Minus size={17} /></IconButton><span aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" disabled={!document || zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .15))}><Plus size={17} /></IconButton></div>
      <div className="pdf-toolbar-group pdf-toolbar-actions">
        <Button variant="ghost" disabled={savingAnnotation} onClick={() => openComposer('highlight')} title="Manual highlight entry" aria-label="Add highlight"><Highlighter size={16} /> <span>Highlight</span></Button>
        <Button variant="ghost" disabled={savingAnnotation} onClick={() => openComposer('note')} title="Add a page note" aria-label="Add note"><MessageSquarePlus size={16} /> <span>Notes</span></Button>
        <IconButton
          className="pdf-fullscreen-toggle"
          label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-pressed={isFullscreen}
          onClick={() => setIsFullscreen((value) => !value)}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </IconButton>
      </div>
    </header>
    <div className="pdf-scroll" ref={containerRef} tabIndex={0} role="region" aria-label={`PDF page ${page}. Use left and right arrow keys to change pages.`} aria-keyshortcuts="ArrowLeft ArrowRight"
      onScroll={() => setSelectionMenu(null)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          navigateToPage(page + (event.key === 'ArrowRight' ? 1 : -1));
        }
      }}>
      {loadError ? <div className="pdf-loading" role="alert">{loadError}</div> : document ? <div
        className="pdf-page" ref={pageRef} role="document" aria-label={`Selectable PDF page ${page}`}
        onContextMenu={openSelectionMenu}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        <div className="pdf-highlight-layer" aria-hidden="true">
          {pageAnnotations.filter((annotation) => annotation.kind === 'highlight').flatMap((annotation) => annotation.rects.map((rect, index) => <span
            key={`${annotation.id}-${index}`}
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: `${annotation.color}66` }}
          />))}
        </div>
        <div className="textLayer pdf-text-layer" ref={textLayerRef} />
      </div> : <div className="pdf-loading"><Spinner label={loading ? 'Loading PDF' : 'Preparing PDF'} /></div>}
    </div>
    {selectionMenu && <div
      className="pdf-selection-menu" ref={selectionMenuRef} role="menu" aria-label="Selected PDF text"
      style={{ left: selectionMenu.x, top: selectionMenu.y }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { setSelectionMenu(null); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = items.indexOf(event.target as HTMLButtonElement);
        items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}
    >
      <button type="button" role="menuitem" onClick={() => void copySelectedPassage()}><Copy size={16} /> Copy</button>
      <button type="button" role="menuitem" onClick={captureSelectedPassage} disabled={savingAnnotation}><Highlighter size={16} /> Highlight</button>
    </div>}
    {(pageAnnotations.length > 0 || compose) && <aside className="annotation-drawer">
      <header>
        <button type="button" className="annotation-toggle" aria-expanded={!annotationsCollapsed} aria-controls={annotationPanelId} onClick={() => setAnnotationsCollapsed((value) => !value)}>
          <span>Notes & highlights <span className="annotation-toggle-meta">· Page {page} · {pageAnnotations.length}</span></span>
          <span className="annotation-toggle-action">{annotationsCollapsed ? 'Expand' : 'Collapse'}{annotationsCollapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span>
        </button>
      </header>
      <div id={annotationPanelId} className="annotation-drawer-content" hidden={annotationsCollapsed}>
      {compose && <div className="annotation-compose" ref={composerRef}>
        <strong>{compose === 'highlight' ? 'Capture an evidence passage' : 'Add a page note'}</strong>
        {composePage !== page && <small>This annotation will be saved on page {composePage}.</small>}
        {compose === 'highlight' && <textarea rows={2} disabled={savingAnnotation} aria-label="Selected evidence passage" value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Paste the selected passage…" />}
        <textarea rows={2} disabled={savingAnnotation} aria-label={compose === 'highlight' ? 'Why does this passage matter?' : 'Write your note'} value={content} onChange={(event) => setContent(event.target.value)} placeholder={compose === 'highlight' ? 'Why does this passage matter?' : 'Write your note…'} />
        <div><Button variant="ghost" disabled={savingAnnotation} onClick={closeComposer}>Cancel</Button><Button onClick={saveAnnotation} disabled={savingAnnotation || (compose === 'highlight' ? !quote.trim() : !content.trim())}>{savingAnnotation ? 'Saving…' : 'Save'}</Button></div>
      </div>}
      {pageAnnotations.map((annotation) => <div key={annotation.id} className={`annotation-item annotation-${annotation.kind}`}>
        <FileText size={15} /> <div>{annotation.quote && <blockquote>“{annotation.quote}”</blockquote>}<p>{annotation.content}</p></div>
        <IconButton label="Delete annotation" onClick={async () => {
          if (!confirm('Delete this annotation?')) return;
          try { await window.litrevolt.reviews.deleteAnnotation(annotation.id); await loadAnnotations(); notify('Annotation deleted.'); }
          catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
        }}><Trash2 size={14} /></IconButton>
      </div>)}
      </div>
    </aside>}
  </section>;
}
