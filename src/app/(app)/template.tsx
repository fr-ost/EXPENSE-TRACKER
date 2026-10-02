/**
 * Re-mounts on navigation: a short fade-and-rise between pages. Plain CSS, so
 * a page is never left invisible while (or if) its JavaScript loads.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
