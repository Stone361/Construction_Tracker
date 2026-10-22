import type { HouseSummary } from '../services/houses'
import { constructionStages, stageLabel } from '../services/houses'
import type { CurrentSummary } from '../services/summary'
import { HouseCard } from './HouseCard'
import styles from './SummaryPanel.module.css'

interface SummaryPanelProps {
  summary: CurrentSummary
  houses: HouseSummary[] | null
  housesError: string | null
  selectedHouseId: number | null
  onSelect: (house: HouseSummary) => void
  onRetryHouses: () => void
  onDetails: (id: number) => void
}

function percentage(count: number, total: number): string {
  if (total === 0) return '0%'
  const value = count / total * 100
  return `${Number(value.toFixed(1))}%`
}

export function SummaryPanel({ summary, houses, housesError, selectedHouseId, onSelect,
  onRetryHouses, onDetails }: SummaryPanelProps) {
  const housesById = new Map(houses?.map(house => [house.id, house]))
  const attentionHouses = summary.staleHouseIds.flatMap(id => {
    const house = housesById.get(id)
    return house ? [house] : []
  })
  const missingCount = houses === null ? 0 : summary.staleHouseIds.length - attentionHouses.length

  return <div className={styles.root}>
    <div className={styles.stats}>
      <div className={styles.stat}><span>Total houses</span><strong>{summary.totalHouses}</strong></div>
      <div className={`${styles.stat} ${styles.attentionStat}`}><span>Needs attention</span><strong>{summary.staleHouseIds.length}</strong></div>
    </div>
    <section className={styles.section} aria-labelledby="stage-summary-title">
      <h3 id="stage-summary-title">Construction stages</h3>
      <p className={styles.explanation}>Current share of all houses</p>
      <ul className={styles.stages}>
        {constructionStages.map(stage => {
          const count = summary.stageCounts[stage]
          const share = percentage(count, summary.totalHouses)
          return <li key={stage}>
            <div className={styles.stageMeta}><span>{stageLabel(stage)}</span><span>{count} · {share}</span></div>
            <div className={styles.track} aria-hidden="true"><span style={{ width: share }} /></div>
          </li>
        })}
      </ul>
    </section>
    <section className={styles.section} aria-labelledby="attention-title">
      <div className={styles.attentionHeading}>
        <h3 id="attention-title">Needs Attention</h3>
        <span>{summary.staleHouseIds.length}</span>
      </div>
      <p className={styles.explanation}>No new site photos in over 14 days.</p>
      {summary.staleHouseIds.length === 0 && <p className={styles.empty}>No houses need attention in the current summary.</p>}
      {summary.staleHouseIds.length > 0 && housesError && <div className={styles.error} role="alert">
        <p>House details could not be loaded. {housesError}</p>
        <button type="button" onClick={onRetryHouses}>Retry house details</button>
      </div>}
      {summary.staleHouseIds.length > 0 && houses === null && !housesError &&
        <p className={styles.empty} role="status">Loading attention house details…</p>}
      {missingCount > 0 && <p className={styles.error} role="alert">
        {missingCount} attention {missingCount === 1 ? 'house is' : 'houses are'} missing from the current house list.{' '}
        <button type="button" onClick={onRetryHouses}>Refresh house details</button>
      </p>}
      {houses !== null && attentionHouses.length > 0 && <ol className={styles.list} aria-label="Needs Attention houses">
        {attentionHouses.map(house => <li key={house.id}>
          <HouseCard house={house} tone="warning" selected={house.id === selectedHouseId}
            onSelect={() => onSelect(house)} onDetails={onDetails} />
        </li>)}
      </ol>}
    </section>
  </div>
}
