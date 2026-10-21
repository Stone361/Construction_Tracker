import { Link, Outlet } from 'react-router'
import styles from './AppShell.module.css'

export function AppShell() {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="Construction Tracker home">
          <span className={styles.mark} aria-hidden="true">CT</span>
          <span>Construction Tracker</span>
        </Link>
        <span className={styles.label}>Workspace preview</span>
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
