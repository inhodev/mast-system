export function isPromotionTarget(assignment) {
  return Boolean(assignment) && assignment.status !== 'exempted'
}

export function promotionMissItems(assignments, missionById, now) {
  const items = []
  for (const a of assignments ?? []) {
    if (!isPromotionTarget(a) || ['submitted', 'approved', 'late'].includes(a.status)) continue
    const mission = missionById?.get(String(a.mission_id))
    const due = mission?.due_at ? Date.parse(mission.due_at) : NaN
    if (!Number.isFinite(due) || now < due) continue
    items.push({ id: `promo-${a.id}`, event_type: 'eta_miss', points: -2, metadata: { reason: `${mission.title || '에타 미션'} 미참여`, auto: true } })
  }
  return items
}

export function promotionSubmissionError(error) {
  const detail = String(error?.message || error?.error || '')
  if (detail === '기존 게시글 인증은 연세대학교 미래캠퍼스만 가능합니다.') return detail
  if (/면제|exempted/i.test(detail)) return '면제된 미션입니다. 인증을 제출하지 않아도 됩니다.'
  if (/제출 시간|지각 제출 가능 시간/.test(detail)) return '인증 제출 시간이 지났습니다. 관리자에게 문의해 주세요.'
  if (/본인 인증 제출|본인에게 배정|배정 정보/.test(detail)) return '배정 상태가 변경되어 제출할 수 없습니다. 홈에서 현재 상태를 확인해 주세요.'
  if (/size|large|exceed/i.test(detail)) return '사진 용량이 너무 큽니다. 10MB 이하로 선택해 주세요.'
  if (/mime|type/i.test(detail)) return '지원하지 않는 사진 형식입니다. JPG 또는 PNG로 선택해 주세요.'
  if (/jwt|token|session|unauthorized|로그인/i.test(detail)) return '로그인 연결을 확인하지 못했어요. 사진은 유지되니 잠시 후 다시 제출해 주세요.'
  return '인증을 저장하지 못했어요. 선택한 사진은 유지됩니다. 다시 제출해 주세요.'
}
