import { useState } from 'react'
import { Icon } from './Icon'
import styles from './LocationSearch.module.css'

export function LocationSearch() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const explain = () => setSubmitted(true)
  return (
    <div className={styles.search}>
      <form aria-label="Location search preview" onSubmit={event => { event.preventDefault(); explain() }}>
        <label className="visuallyHidden" htmlFor="location-search">City or ZIP code</label>
        <div className={styles.field}>
          <Icon name="search" size={22} />
          <input id="location-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setSubmitted(false) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); explain() } }} placeholder="City or ZIP code" autoComplete="off" spellCheck={false} aria-describedby="location-search-help" />
          <span className={styles.badge}>Coming soon</span>
        </div>
      </form>
      <p id="location-search-help" className={styles.help} role="status">{submitted ? 'Location search isn’t available yet. Explore map opens Austin, regardless of this input.' : 'City & ZIP search is coming soon. Explore map opens Austin, Texas.'}</p>
    </div>
  )
}
