import { promotionSchoolKey } from './promotionSchoolRules.js'

export function groupSchool(rotation, school) {
  return rotation?.schools?.find(row => row.school_key === promotionSchoolKey(school)) ?? null
}

export function nextGroupMember(school) {
  const roster = school?.members ?? []
  if (!roster.length) return null
  const last = roster.findIndex(row => String(row.id) === String(school.last_member_id))
  return roster[(last + 1) % roster.length]
}

export function groupPicks(rotation) {
  return (rotation?.schools ?? []).filter(row => row.group_code === rotation.next_group)
    .map(row => ({ school: row, member: nextGroupMember(row) }))
}

export function addRotationDays(date, days) {
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(timestamp) ? new Date(timestamp + days * 86400000).toISOString().slice(0, 10) : null
}

export function groupPrediction({ rotation, member, assignments = [], today }) {
  const school = groupSchool(rotation, member?.school)
  if (!school || !school.members.length) return null
  const confirmed = assignments.filter(row => String(row.member_id) === String(member.id) && row.status !== 'exempted' && row.mission_date >= today)
    .sort((a, b) => a.mission_date.localeCompare(b.mission_date))[0]
  if (confirmed) return { date: confirmed.mission_date, confirmed: true, group: school.group_code }
  const next = nextGroupMember(school)
  const start = school.members.findIndex(row => String(row.id) === String(next?.id))
  const mine = school.members.findIndex(row => String(row.id) === String(member?.id))
  if (mine < 0 || start < 0) return null
  const personalOffset = (mine - start + school.members.length) % school.members.length
  const groupOffset = ('ABC'.indexOf(school.group_code) - rotation.next_round % 3 + 3) % 3
  const nextDate = rotation.next_date < today ? today : rotation.next_date
  return { date: addRotationDays(nextDate, groupOffset * rotation.interval_days + personalOffset * rotation.interval_days * 3), confirmed: false, group: school.group_code }
}
