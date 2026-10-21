import type { ReactNode } from 'react'
import styles from './PageIntro.module.css'

interface PageIntroProps {
  eyebrow: string
  title: string
  children: ReactNode
}

export function PageIntro({ eyebrow, title, children }: PageIntroProps) {
  return (
    <section className={styles.card}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.content}>{children}</div>
    </section>
  )
}
