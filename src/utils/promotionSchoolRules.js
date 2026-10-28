const normalizeSchool = (school) => String(school ?? '').replace(/\s/g, '').toLowerCase()
export function canonicalPromotionSchool(school) {
  const key = normalizeSchool(school).replace(/[()（）]/g, '').replace(/캠퍼스|캠/g, '')
  if (/^연세대(?:학교)?미래$/.test(key)) return '연세대학교(미래)'
  if (/^한양대(?:학교)?(?:erica|에리카)$/.test(key)) return '한양대학교 ERICA'
  const aliases = {
    고려대학교세종: '고려대학교(세종)', 단국대학교천안: '단국대학교(천안)',
    홍익대학교세종: '홍익대학교(세종)', 강원대학교춘천: '강원대학교(춘천)',
    상명대학교서울: '상명대학교(서울)', 동국대학교서울: '동국대학교',
    서울홍익대학교: '홍익대학교', 한경국립대: '한경국립대학교',
  }
  return aliases[key] || String(school ?? '').trim()
}
export function promotionSchoolKey(school) {
  return normalizeSchool(canonicalPromotionSchool(school))
}
export function nextRotationMember(members, memberId) {
  const index = members.findIndex(member => member.id === memberId)
  return members.length > 1 && index >= 0 ? members[(index + 1) % members.length] : null
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
