import { useEffect, useState } from 'react';
import { ExternalLink, GitFork, Heart, Scale } from 'lucide-react';
import type { AboutInfo } from '../../shared/types';
import { PASS_GUIDES } from '../../shared/workflow';
import logoUrl from '../../../assets/branding/litrevolt-logo.svg';
import darkLogoUrl from '../../../assets/branding/litrevolt-logo-dark.svg';
import { Button, Card } from './ui';

export function AboutScreen() {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void window.litrevolt.app.getAbout().then(setInfo).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, []);
  return <div className="page about-page">
    <section className="about-hero"><img className="theme-logo theme-logo-light" src={logoUrl} alt="LitRevolt" /><img className="theme-logo theme-logo-dark" src={darkLogoUrl} alt="LitRevolt" /><span className="about-version">Version {info?.version ?? '…'}</span><h1>A three-pass research paper reader</h1><p>Read deeper. Think critically. Review with purpose.</p></section>
    <Card className="about-reading-guide">
      <h2 id="reading-guide-heading">Three-pass reading guide</h2>
      <table className="reading-guide-table" aria-labelledby="reading-guide-heading">
        <thead><tr><th scope="col">Pass no.</th><th scope="col">What to read</th><th scope="col">Purpose</th></tr></thead>
        <tbody>{Object.entries(PASS_GUIDES).map(([pass, guide]) => <tr key={pass}>
          <th scope="row">{pass}</th><td>{guide.readingScope}</td><td>{guide.readingPurpose}</td>
        </tr>)}</tbody>
      </table>
      <p className="reading-guide-attribution">Adapted from S. Keshav, ‘How to Read a Paper’ (2007), §§2.1–2.3.</p>
      <p className="reading-guide-context">Keshav recommends up to three passes depending on your reading needs. LitRevolt’s complete review follows all three.</p>
    </Card>
    <div className="about-grid">
      <Card><h2>Independent by design</h2><p>LitRevolt is an independent open-source project. It is not affiliated with or endorsed by S. Keshav, Anthropic, OpenAI, Moonshot AI, Google, TeachPaper, or another research application.</p></Card>
      <Card><h2>Method acknowledgment</h2><p>The reading workflow is based on S. Keshav’s three-pass method. LitRevolt adds closed-book retrieval, paper-grounded evaluation, and an explicit understanding score.</p></Card>
      <Card><h2>Open source</h2><p><Scale size={18} /> Released under the MIT License.</p>{info?.githubUrl ? <Button variant="secondary" onClick={() => {
        void window.litrevolt.app.openExternal(info.githubUrl!).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
      }}><GitFork size={17} /> GitHub repository <ExternalLink size={14} /></Button> : <p className="muted">Repository URL not configured for this build.</p>}{error && <p className="form-error" role="alert">{error}</p>}</Card>
      <Card><h2>AI providers</h2><p>Optional paper-grounded features send requests directly to Anthropic, OpenAI, Kimi, or Gemini using your own key for the selected provider. Provider terms and usage charges apply. The providers do not endorse or operate LitRevolt.</p></Card>
    </div>
    <footer className="about-footer"><Heart size={16} /> Built for readers who want to test what they understand.</footer>
  </div>;
}
