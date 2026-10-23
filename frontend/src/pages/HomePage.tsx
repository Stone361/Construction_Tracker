import { Link } from 'react-router'
import { ConstructionMap } from '../components/map/ConstructionMap'
import { LocationSearch } from '../components/LocationSearch'
import { Icon } from '../components/Icon'
import styles from './HomePage.module.css'

export function HomePage() {
  return (
    <div className={styles.page}>
      <div className={styles.backdrop}><ConstructionMap decorative /></div>
      <div className={styles.veil} aria-hidden="true" />
      <div className={styles.content}>
        <h1>A clearer view of<br /><span>what’s taking shape.</span></h1>
        <p className={styles.description}>Explore the places where communities are growing.</p>
        <LocationSearch />
        <Link className={styles.explore} to="/map">Explore map<Icon name="arrow-right" size={19} /></Link>
      </div>
      <div className={styles.location}><Icon name="pin" size={14} /><span>Austin, Texas</span><span className={styles.coordinates}>30.2672° N · 97.7431° W</span></div>
    </div>
  )
}
