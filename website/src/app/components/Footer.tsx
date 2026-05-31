import Link from "next/link";
import Glyph from "./Glyph";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-inner">
          <span className="copy">
            <Glyph className="glyph" />
            © {new Date().getFullYear()} Omelas · Brain Memory
          </span>
          <div className="footer-links">
            <Link href="/docs">Docs</Link>
            <a href="https://github.com/omelas-tech/brain" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer">npm</a>
            <Link href="/privacy">Privacy</Link>
            <a href="https://omelas.tech" target="_blank" rel="noopener noreferrer">Omelas</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
