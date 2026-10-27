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
export function promotionIntervalDays(school) {
  return promotionSchoolKey(school) === '연세대학교(미래)' ? 14 : 3
}
export function promotionCopyForSchool(body, school) {
  const text = String(body ?? '')
  if (!normalizeSchool(school).startsWith('한국외국어대학교') || text.includes(HUFS_REQUIRED_COPY)) return text
  return [text, HUFS_REQUIRED_COPY].filter(Boolean).join('\n\n')
}
