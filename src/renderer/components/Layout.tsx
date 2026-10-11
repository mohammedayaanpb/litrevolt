import { BookOpenCheck, BookOpenText, FolderKanban, Info, Library, Settings } from 'lucide-react';
import logoUrl from '../../../assets/branding/litrevolt-logo.svg';
import darkLogoUrl from '../../../assets/branding/litrevolt-logo-dark.svg';
import iconUrl from '../../../assets/branding/litrevolt-icon.svg';
import type { ReactNode } from 'react';

export type MainView = 'library' | 'projects' | 'reviews' | 'settings' | 'about';

const items: Array<{ id: MainView; label: string; icon: typeof Library }> = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'reviews', label: 'Reviews', icon: BookOpenCheck },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'about', label: 'About', icon: Info },
];

export function Layout({ active, onNavigate, children }: { active: MainView; onNavigate(view: MainView): void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => onNavigate('library')} aria-label="Go to LitRevolt library">
          <img className="brand-mark" src={iconUrl} alt="" />
          <img className="theme-logo theme-logo-light" src={logoUrl} alt="LitRevolt" />
          <img className="theme-logo theme-logo-dark" src={darkLogoUrl} alt="LitRevolt" />
        </button>
        <nav aria-label="Primary navigation">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => onNavigate(item.id)}>
                <Icon size={19} aria-hidden /> <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <BookOpenText size={18} />
          <p><strong>Three deliberate passes.</strong><br />One defensible understanding.</p>
        </div>
      </aside>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
