import { useState } from 'react';
import { ArrowRight, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import type { LibrarySnapshot } from '../../shared/types';
import { Button, Card, EmptyState, Field, PageHeader, Spinner } from './ui';

export function ProjectsScreen({ library, onRefresh, notify, onOpenPaper, onBrowseProject }: {
  library: LibrarySnapshot | null;
  onRefresh(): Promise<LibrarySnapshot>;
  notify(message: string, tone?: 'success' | 'error'): void;
  onOpenPaper(id: string): void;
  onBrowseProject(id: string): void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setShowForm(true);
  };

  const openEdit = (id: string, projectName: string, projectDescription: string) => {
    setEditingId(id);
    setName(projectName);
    setDescription(projectDescription);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName('');
    setDescription('');
  };

  const saveProject = async () => {
    setBusy(true);
    try {
      if (editingId) await window.litrevolt.library.updateProject(editingId, { name, description });
      else await window.litrevolt.library.createProject({ name, description });
      await onRefresh();
      const message = editingId ? 'Project updated.' : 'Project created.';
      closeForm();
      notify(message);
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, projectName: string) => {
    if (!confirm(`Delete the project “${projectName}”? Papers remain in the general library, and existing reviews become unfiled.`)) return;
    try { await window.litrevolt.library.deleteProject(id); await onRefresh(); notify('Project deleted.'); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
  };

  return (
    <div className="page projects-page">
      <PageHeader eyebrow="Research contexts" title="Projects" description="Group related papers while keeping each review independent."
        actions={<Button onClick={openCreate} disabled={busy || showForm}><Plus size={17} /> New project</Button>} />
      {showForm && <form className="card project-form" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !busy) void saveProject(); }}>
        <div><span className="eyebrow">{editingId ? 'Edit research context' : 'New research context'}</span><h2>{editingId ? 'Edit project' : 'Create a project'}</h2></div>
        <Field label="Project name"><input autoFocus required maxLength={200} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Embodied planning" /></Field>
        <Field label="Description" hint="What question or body of work connects these papers?"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field>
        <div className="form-actions"><Button type="button" variant="ghost" disabled={busy} onClick={closeForm}>Cancel</Button><Button type="submit" disabled={!name.trim() || busy}>{busy ? <Spinner label="Saving" /> : editingId ? 'Save changes' : 'Create project'}</Button></div>
      </form>}
      {(library?.projects.length ?? 0) === 0 ? !showForm && (
        <EmptyState icon={<FolderKanban size={32} />} title="No projects yet" action={<Button onClick={openCreate}><Plus size={17} /> Create a project</Button>}>
          Projects help you organize related papers and maintain independent reviews for different research contexts.
        </EmptyState>
      ) : <div className="project-grid">
        {library?.projects.map((project, index) => {
          const papers = library.papers.filter((paper) => paper.projectIds.includes(project.id));
          return <Card className="project-card" key={project.id}>
            <header><div className={`project-glyph project-glyph-${index % 4}`}><FolderKanban size={22} /></div><button className="icon-button" disabled={busy} aria-label={`Edit ${project.name}`} title={`Edit ${project.name}`} onClick={() => openEdit(project.id, project.name, project.description)}><Pencil size={17} /></button></header>
            <h2>{project.name}</h2><p>{project.description || 'No project description yet.'}</p>
            <div className="project-papers">
              {papers.slice(0, 3).map((paper) => <button key={paper.id} onClick={() => onOpenPaper(paper.id)}>{paper.title}</button>)}
              {papers.length === 0 && <small>No papers assigned</small>}
              <button className="project-browse" onClick={() => onBrowseProject(project.id)}>{papers.length ? `View all ${papers.length} ${papers.length === 1 ? 'paper' : 'papers'}` : 'Add papers to this project'} <ArrowRight size={14} /></button>
            </div>
            <footer><span>{project.paperCount} {project.paperCount === 1 ? 'paper' : 'papers'}</span><Button variant="ghost" onClick={() => remove(project.id, project.name)}><Trash2 size={15} /> Delete</Button></footer>
          </Card>;
        })}
      </div>}
    </div>
  );
}
