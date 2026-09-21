/**
 * 对照视图：一句一句地对照「原文 / 修改后的完整那句」。
 *
 * 这里只做一件事——把**精修档**的那份批改（逐处错误）算成对照行，然后交给 `CompareLines` 渲染。
 * 大改档走的是另一个入口（`RefineView`），两边共用同一套渲染，
 * 因此"对照视图"在两种档位下长得一模一样（见 CompareLines.tsx 的说明）。
 */

import { useMemo } from 'react'
import type { ValidatedCorrection } from '../domain/validate'
import { buildCompareLines } from '../domain/compare'
import { CompareLines } from './CompareLines'
import type { Selection } from './annotation-summary'

export function CompareView({
  validated,
  answer,
  selection,
  onSelect,
}: {
  validated: ValidatedCorrection
  answer: string
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
}) {
  const lines = useMemo(() => buildCompareLines(validated, answer), [validated, answer])
  return <CompareLines lines={lines} selection={selection} onSelect={onSelect} />
}
