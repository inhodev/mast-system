const normalizeSchool = (school) => String(school ?? '').replace(/\s/g, '').toLowerCase()
export function promotionSchoolKey(school) {
  const key = normalizeSchool(school)
  return /^연세대(?:학교)?/.test(key) && key.includes('미래') ? '연세대학교(미래)' : key
}
export function schoolRotationHistory(rows, school) {
  return rows.filter(row => row.status !== 'exempted' && promotionSchoolKey(row.school) === promotionSchoolKey(school))
    .sort((a, b) => String(b.mission_date).localeCompare(String(a.mission_date)))
}
export function isSchoolRotationDue(school, rows, date) {
  const last = schoolRotationHistory(rows, school)[0]
  if (!last) return true
  return (Date.parse(date + 'T00:00:00+09:00') - Date.parse(last.mission_date + 'T00:00:00+09:00')) / 86400000 >= promotionIntervalDays(school)
}
export const HUFS_REQUIRED_COPY = '본 단체는 한국외국어대학교 경영전략학회 MAST와는 무관합니다.'
export function promotionIntervalDays() {
  return 3
}
export function allowsExistingPostProof(school) {
  return promotionSchoolKey(school) === '연세대학교(미래)'
}
export function nextPromotionDate({ member, members, assignments, today }) {
  if (!member?.id || !member.school || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const roster = members.filter(row => (row.status || 'active') === 'active' && promotionSchoolKey(row.school) === promotionSchoolKey(member.school))
    .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko') ||
      Number(String(a.gi || '').replace(/\D/g, '') || 999) - Number(String(b.gi || '').replace(/\D/g, '') || 999) || String(a.id).localeCompare(String(b.id)))
  const memberIndex = roster.findIndex(row => row.id === member.id)
  if (memberIndex < 0) return null
  const history = schoolRotationHistory(assignments.filter(row => row.mission_date <= today), member.school)
  const last = history[0]
  if (history.some(row => row.mission_date === today && row.member_id === member.id)) return today
  const interval = promotionIntervalDays(member.school)
  const lastIndex = last ? roster.findIndex(row => row.id === last.member_id) : -1
  const nextIndex = (lastIndex + 1) % roster.length
  const position = (memberIndex - nextIndex + roster.length) % roster.length
  const day = Date.parse(today + 'T00:00:00Z')
  const earliest = last ? Date.parse(last.mission_date + 'T00:00:00Z') + interval * 86400000 : day + 86400000
  const date = Math.max(day + 86400000, earliest) + position * interval * 86400000
  return Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : null
}
export function promotionCopyForSchool(body, school) {
  const text = String(body ?? '')
  if (!normalizeSchool(school).startsWith('한국외국어대학교') || text.includes(HUFS_REQUIRED_COPY)) return text
  return [text, HUFS_REQUIRED_COPY].filter(Boolean).join('\n\n')
}
