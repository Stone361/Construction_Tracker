import type { DemoIdentity } from '../app/DemoIdentityContext'
import { canManageHouse } from '../services/demoPermissions'
import { constructionProgressFor } from '../services/constructionProgress'
import { constructionStages, stageLabel } from '../services/houses'
import type { ConstructionStage } from '../services/houses'
import type { HouseDetail } from '../services/houseDetail'
import styles from './ConstructionProgress.module.css'

export function ConstructionProgress({ house, identity, advancing, onRequestAdvance }: {
  house: HouseDetail
  identity: DemoIdentity
  advancing: boolean
  onRequestAdvance: (fromStage: ConstructionStage, toStage: ConstructionStage) => void
}) {
  const progress = constructionProgressFor(house)
  const canManage = canManageHouse(identity, house.community)

  return <section className={styles.card} aria-labelledby="construction-progress-heading">
    <div className={styles.heading}>
      <div>
        <p className={styles.eyebrow}>CONSTRUCTION STATUS</p>
        <h2 id="construction-progress-heading">Construction progress</h2>
      </div>
      {progress.currentStage !== null && <span className={styles.stageCount}>
        Stage {progress.currentIndex + 1} of {constructionStages.length}
      </span>}
    </div>

    <ol className={styles.steps} aria-label="Construction stages">
      {constructionStages.map((stage, index) => {
        const state = progress.currentIndex < 0 || index > progress.currentIndex
          ? 'upcoming' : index === progress.currentIndex ? 'current' : 'past'
        return <li key={stage} className={`${styles.step} ${styles[state]}`}
          aria-current={state === 'current' ? 'step' : undefined}>
          <span className={styles.stepNumber}>{index + 1}</span>
          <span className={styles.stepName}>{stageLabel(stage)}</span>
        </li>
      })}
    </ol>

    <div className={styles.summary}>
      <div><span>Current stage</span><strong>{stageLabel(progress.currentStage)}</strong></div>
      <div><span>Next stage</span><strong>{progress.currentStage === null ? 'Unavailable'
        : progress.nextStage === null ? 'None — final stage' : stageLabel(progress.nextStage)}</strong></div>
    </div>

    <div className={styles.condition}>
      <p className={styles.conditionTitle}>Current-stage photo requirement
        <strong className={progress.photoRequirementMet ? styles.met : styles.unmet}>
          {progress.photoRequirementMet ? 'Satisfied' : 'Not satisfied'}
        </strong>
      </p>
      <p>{progress.currentStage === null
        ? 'The current stage is unavailable, so photo eligibility cannot be determined.'
        : progress.photoRequirementMet
          ? `${progress.eligiblePhotoCount} current-stage ${progress.eligiblePhotoCount === 1 ? 'photo has' : 'photos have'} VERIFIED or UNKNOWN GPS status.`
          : progress.currentStagePhotoCount === 0
            ? 'No photo is linked to the current stage. At least one non-SUSPECT photo is required.'
            : 'Current-stage photos are SUSPECT or lack a qualifying GPS status. At least one VERIFIED or UNKNOWN photo is required.'}</p>
      <p className={styles.authority}>This is a read-only estimate from the house details. The backend makes the final decision.</p>
    </div>

    {progress.currentStage === 'CO_READY' && <p className={styles.note}>CO ready is the final stage. No further advance is available.</p>}
    {progress.currentStage !== null && progress.nextStage !== null && !canManage &&
      <p className={styles.note}>Read-only for this Demo identity. Only Admin or this house’s Site Manager can advance its stage.</p>}
    {progress.currentStage !== null && progress.nextStage !== null && canManage && <div className={styles.action}>
      <button type="button" disabled={!progress.photoRequirementMet || advancing}
        onClick={() => {
          if (progress.currentStage !== null && progress.nextStage !== null) {
            onRequestAdvance(progress.currentStage, progress.nextStage)
          }
        }}>
        {advancing ? 'Submitting stage advance…'
          : progress.photoRequirementMet ? `Advance to ${stageLabel(progress.nextStage)}` : 'Advance unavailable'}
      </button>
      <span>{advancing ? 'Waiting for the backend response. Do not submit again.'
        : progress.photoRequirementMet ? 'A confirmation is required before submission.'
          : 'Add a qualifying photo to the current stage before advancing.'}</span>
    </div>}
  </section>
}
