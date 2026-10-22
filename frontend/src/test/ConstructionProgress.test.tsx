import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConstructionProgress } from '../components/ConstructionProgress'
import { constructionProgressFor } from '../services/constructionProgress'
import { constructionStages, stageLabel } from '../services/houses'
import type { HouseDetail, HousePhoto } from '../services/houseDetail'
import type { DemoIdentity } from '../app/DemoIdentityContext'

const viewer: DemoIdentity = { user: 'frontend-demo', role: 'VIEWER', community: null }
const admin: DemoIdentity = { user: 'frontend-demo', role: 'ADMIN', community: null }
const manager = (community: string): DemoIdentity => ({ user: 'frontend-demo', role: 'SITE_MANAGER', community })
const house: HouseDetail = {
  id: 12, permitNo: 'P-12', address: '12 Main St', community: 'North Austin',
  lat: 30.2, lng: -97.7, stage: 'FOUNDATION', coverPhotoId: null, sourceType: 'MANUAL',
  sourceUrl: null, sourceFetchedAt: null, createdAt: null, createdBusinessDate: null,
  createdBy: null, updatedAt: null, photos: [],
}
const photo = (id: number, stage: HousePhoto['stage'], status: 'VERIFIED' | 'SUSPECT' | 'UNKNOWN' | null): HousePhoto => ({
  id, stage, locationStatus: status, takenAt: null, uploadedAt: null, businessDate: null, url: null,
})
const noop = () => undefined

describe('construction progress from house detail', () => {
  it.each(constructionStages.map((stage, index) => ({
    stage, index, next: constructionStages[index + 1] ?? null,
  })))('keeps $stage at step $index with the next adjacent stage', ({ stage, index, next }) => {
    const result = constructionProgressFor({ stage, photos: [] })
    expect(result.currentIndex).toBe(index)
    expect(result.nextStage).toBe(next)
  })

  it('counts only current-stage VERIFIED and UNKNOWN photos; SUSPECT and missing status do not qualify', () => {
    const photos = [photo(1, 'LAND_CLEARING', 'VERIFIED'), photo(2, 'FOUNDATION', 'SUSPECT'),
      photo(3, 'FOUNDATION', null), photo(4, 'FOUNDATION', 'UNKNOWN')]
    expect(constructionProgressFor({ stage: 'FOUNDATION', photos })).toMatchObject({
      currentStagePhotoCount: 3, eligiblePhotoCount: 1, photoRequirementMet: true,
    })
    expect(constructionProgressFor({ stage: 'FOUNDATION', photos: photos.slice(0, 3) })).toMatchObject({
      currentStagePhotoCount: 2, eligiblePhotoCount: 0, photoRequirementMet: false,
    })
    expect(constructionProgressFor({ stage: null, photos })).toMatchObject({
      currentIndex: -1, nextStage: null, photoRequirementMet: false,
    })
  })

  it('shows six stages and requests confirmation only when an authorized action is available', async () => {
    const requestAdvance = vi.fn()
    const eligibleHouse = { ...house, photos: [photo(1, 'FOUNDATION', 'UNKNOWN')] }
    const { rerender } = render(<ConstructionProgress house={eligibleHouse} identity={admin}
      advancing={false} onRequestAdvance={requestAdvance} />)
    const stages = within(screen.getByRole('list', { name: 'Construction stages' })).getAllByRole('listitem')
    expect(stages).toHaveLength(6)
    expect(stages[1]).toHaveAttribute('aria-current', 'step')
    expect(stages.map(item => item.textContent)).toEqual(constructionStages.map((stage, index) =>
      `${index + 1}${stageLabel(stage)}`))
    expect(screen.getByText('Satisfied')).toBeInTheDocument()
    expect(screen.getByText(/1 current-stage photo has VERIFIED or UNKNOWN/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Advance to Framing' }))
    expect(requestAdvance).toHaveBeenCalledWith('FOUNDATION', 'FRAMING')
    rerender(<ConstructionProgress house={eligibleHouse} identity={admin}
      advancing onRequestAdvance={requestAdvance} />)
    expect(screen.getByRole('button', { name: /Submitting stage advance/ })).toBeDisabled()
  })

  it('explains missing eligibility and gives no action to Viewer or a different-community manager', () => {
    const onlySuspect = { ...house, photos: [photo(1, 'FOUNDATION', 'SUSPECT')] }
    const { rerender } = render(<ConstructionProgress house={onlySuspect} identity={viewer}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.getByText('Not satisfied')).toBeInTheDocument()
    expect(screen.getByText(/SUSPECT or lack a qualifying GPS status/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument()
    rerender(<ConstructionProgress house={onlySuspect} identity={manager('Other community')}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument()
    rerender(<ConstructionProgress house={onlySuspect} identity={manager('North Austin')}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.getByRole('button', { name: /Advance unavailable/ })).toBeDisabled()
    rerender(<ConstructionProgress house={onlySuspect} identity={manager('north austin')}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument()
  })

  it('updates with a different house and treats CO_READY as terminal for every role', () => {
    const { rerender } = render(<ConstructionProgress house={house} identity={admin}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.getByText('Not satisfied')).toBeInTheDocument()
    rerender(<ConstructionProgress house={{ ...house, id: 13, stage: 'CO_READY',
      photos: [photo(2, 'CO_READY', 'VERIFIED')] }} identity={admin}
      advancing={false} onRequestAdvance={noop} />)
    expect(screen.getByText('None — final stage')).toBeInTheDocument()
    expect(screen.getByText(/No further advance is available/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument()
  })
})
