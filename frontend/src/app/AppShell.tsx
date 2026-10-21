import { Link, NavLink, Outlet } from 'react-router'
import { DemoIdentitySelector } from './DemoIdentitySelector'
import styles from './AppShell.module.css'

export function AppShell() {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="Construction Tracker home">
          <span className={styles.mark} aria-hidden="true">CT<span /></span>
          <span>Construction<span className={styles.brandLight}> Tracker</span></span>
        </Link>
        <nav className={styles.navigation} aria-label="Primary navigation">
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : undefined}>Overview</NavLink>
          <NavLink to="/map" className={({ isActive }) => isActive ? styles.active : undefined}>Explore map</NavLink>
        </nav>
        <DemoIdentitySelector />
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  )
}
