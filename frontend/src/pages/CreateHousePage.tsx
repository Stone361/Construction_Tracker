import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { ApiError } from '../services/apiClient'
import { createHouse, emptyHouseForm, validateHouseForm } from '../services/createHouse'
import type { HouseFormErrors, HouseFormField, HouseFormValues } from '../services/createHouse'
import { canCreateHouse } from '../services/demoPermissions'
import { mapSnapshotFromState } from '../services/mapNavigation'
import styles from './CreateHousePage.module.css'

export function CreateHousePage() {
  const { identity, version } = useDemoIdentity()
  const location = useLocation()
  const navigate = useNavigate()
  const snapshot = mapSnapshotFromState(location.state)
  const backState = snapshot ? { mapSnapshot: snapshot } : undefined
  const [values, setValues] = useState<HouseFormValues>(emptyHouseForm)
  const [errors, setErrors] = useState<HouseFormErrors>({})
  const [result, setResult] = useState<
    | { version: number; kind: 'submitting' }
    | { version: number; kind: 'error'; message: string }
    | { version: number; kind: 'existing'; id: number }
    | null
  >(null)
  const latestVersion = useRef(version)
  const pending = useRef<AbortController | null>(null)
  const duplicateHeading = useRef<HTMLHeadingElement | null>(null)
  useLayoutEffect(() => { latestVersion.current = version }, [version])
  useEffect(() => {
    if (result?.version === version && result.kind === 'existing') duplicateHeading.current?.focus()
  }, [result, version])
  useEffect(() => () => {
    pending.current?.abort()
    pending.current = null
  }, [version])

  const submitting = result?.version === version && result.kind === 'submitting'
  const existing = result?.version === version && result.kind === 'existing' ? result : null
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canCreateHouse(identity) || submitting || existing || pending.current) return
    const validated = validateHouseForm(values)
    setErrors(validated.errors)
    if (!validated.payload) return
    const controller = new AbortController()
    pending.current = controller
    setResult({ version, kind: 'submitting' })
    try {
      const response = await createHouse(validated.payload, controller.signal, identity)
      if (!controller.signal.aborted && latestVersion.current === version) {
        if (response.kind === 'created') navigate(`/houses/${response.id}`, { state: backState })
        else setResult({ version, kind: 'existing', id: response.id })
      }
    } catch (error) {
      if (!controller.signal.aborted && latestVersion.current === version) {
        setResult({ version, kind: 'error', message: error instanceof ApiError
          ? error.message : 'The house could not be created. Check the connection and try again.' })
      }
    } finally {
      if (pending.current === controller) pending.current = null
    }
  }

  const update = (field: HouseFormField, value: string) => {
    setValues(current => ({ ...current, [field]: value }))
    setErrors(current => ({ ...current, [field]: undefined }))
    if (result?.kind === 'error') setResult(null)
  }

  const field = (name: HouseFormField, label: string, options: {
    required?: boolean; maxLength?: number; inputMode?: 'decimal'; type?: string; placeholder?: string
  } = {}) => (
    <label className={styles.field} htmlFor={`house-${name}`} key={name}>
      <span>{label}{options.required && <span className={styles.required}> *</span>}</span>
      <input id={`house-${name}`} name={name} type={options.type ?? 'text'}
        value={values[name]} maxLength={options.maxLength} inputMode={options.inputMode}
        placeholder={options.placeholder} aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `error-${name}` : undefined}
        onChange={event => update(name, event.target.value)} />
      {errors[name] && <small id={`error-${name}`} role="alert">{errors[name]}</small>}
    </label>
  )

  return <div className={styles.page}><div className={styles.inner}>
    <Link className={styles.back} to="/map" state={backState}>← Back to map</Link>
    <div className={styles.heading}>
      <p className={styles.eyebrow}>HOUSE RECORD · ADMIN</p>
      <h1>Add house</h1>
      <p>Create a house using the existing backend API. This is a demo identity, not a real login.</p>
    </div>
    {!canCreateHouse(identity) ? <section className={styles.card} role="alert">
      <h2>Access denied</h2>
      <p>Only Admin can add houses. Switch the demo identity to Admin or return to the map.</p>
    </section> : <form className={styles.card} onSubmit={submit} noValidate>
      <h2>House information</h2>
      <div className={styles.fields}>
        {field('permitNo', 'Permit number', { required: true, maxLength: 128 })}
        {field('address', 'Address', { required: true, maxLength: 512 })}
        {field('community', 'Community / administrative area', { required: true, maxLength: 128 })}
      </div>
      <h2>Location <span>(optional)</span></h2>
      <p className={styles.help}>Enter both coordinates manually, or leave both blank. No address lookup or GPS verification is performed.</p>
      <div className={styles.fields}>
        {field('lat', 'Latitude', { inputMode: 'decimal', placeholder: '-90 to 90' })}
        {field('lng', 'Longitude', { inputMode: 'decimal', placeholder: '-180 to 180' })}
      </div>
      <h2>Public source <span>(optional)</span></h2>
      <p className={styles.help}>For an imported public record, provide both the HTTP(S) source URL and its local fetch time. Leave both blank for a manual record.</p>
      <div className={styles.fields}>
        {field('sourceUrl', 'Source URL', { maxLength: 2048, type: 'url' })}
        {field('sourceFetchedAt', 'Source fetched at · local time', { type: 'datetime-local' })}
      </div>
      {result?.version === version && result.kind === 'error' &&
        <p className={styles.submitError} role="alert">{result.message}</p>}
      {existing && <div className={styles.duplicate} role="alert" aria-labelledby="duplicate-heading">
        <h2 id="duplicate-heading" ref={duplicateHeading} tabIndex={-1}>House already exists</h2>
        <p>A house with this permit number already exists. No new house was created.</p>
        <div className={styles.duplicateActions}>
          <button type="button" onClick={() => navigate(`/houses/${existing.id}`, { state: backState })}>View existing house</button>
          <button type="button" onClick={() => setResult(null)}>Stay here</button>
        </div>
      </div>}
      <div className={styles.actions}>
        <Link to="/map" state={backState}>Cancel</Link>
        <button type="submit" disabled={submitting || Boolean(existing)}>{submitting ? 'Creating house…' : 'Create house'}</button>
      </div>
    </form>}
  </div></div>
}
