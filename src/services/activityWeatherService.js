import { promotionMissItems } from '../utils/promotionAssignmentPolicy.js'
import { LEGACY_MEMBER_FIELDS } from './baseService'
import { requireSupabase, TABLES } from './baseService'
import { ACTIVITY_WEATHER_PRESETS, calculateActivityWeather, calculateWeatherFromEvents, WEATHER_BASE_SCORE, OFFLINE_EVENT_TYPES, OFFLINE_TARGET_POINTS } from '../utils/activityWeather'
import { findAttendanceMember } from './attendanceService'

// 아래 타입은 저장 점수가 아니라 기록에서 실시간 계산합니다(합산에서 제외해 중복/잔존 방지).
//  - 출석 점수(attendance, 구버전 ot_late 등): 출석 기록에서 계산
//  - 에타 미참여(eta_miss): 마감 지난 홍보 미션 미제출에서 계산
const DERIVED_EVENT_TYPES = ['attendance', 'attendance_late', 'ot_late', 'ot_late_30', 'eta_miss', 'contest_join']
function norm(v) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ') }
function genNum(v) { return String(v ?? '').replace(/[^0-9]/g, '') }

// team_matching 회원 → 출석용 레거시 members 행 매칭 (findAttendanceMember와 동일 기준)
function matchLegacyMember(member, legacyList) {
  if (member?.mast_member_id != null) {
    const direct = (legacyList ?? []).find((l) => String(l.id) === String(member.mast_member_id))
    if (direct) return direct
  }
  const n = norm(member?.name), s = norm(member?.school), g = genNum(member?.generation)
  const strict = (legacyList ?? []).find((l) => norm(l.name) === n && (!s || norm(l.school) === s) && (!g || genNum(l.gi ?? l.generation) === g))
  if (strict) return strict
  const byName = (legacyList ?? []).filter((l) => norm(l.name) === n)
  return byName.length === 1 ? byName[0] : null
}

// 출석 기록을 활동날씨 가감점 항목으로 변환 (상태 자동 점수)
//  - OT(오리엔테이션) 모임: 정참 +5 / 결석 -10 / 지각 -1·-3
//  - 일반 모임: 점수 미반영 (지각 감점도 OT만 적용)
function attendanceItemsFromRecords(records, sessionById) {
  const items = []
  for (const r of records ?? []) {
    const s = sessionById && sessionById.get(String(r.session_id))
    if (!s) continue
    const isOT = Boolean(s.is_orientation)
    if (!isOT) continue // 일반 모임은 점수 미반영
    const title = s.title || 'OT'
    const status = String(r.status)
    if (status === 'late') {
      const pts = Number(r.points)
      const points = Number.isFinite(pts) && pts < 0 ? pts : -1
      items.push({ id: `att-${r.id}`, event_type: 'attendance', points, metadata: { reason: `${title} 지각`, auto: true } })
    } else if (status === 'present') {
      items.push({ id: `att-${r.id}`, event_type: 'attendance', points: 5, metadata: { reason: `${title} 정참`, auto: true } })
    } else if (status === 'absent') {
      items.push({ id: `att-${r.id}`, event_type: 'attendance', points: -10, metadata: { reason: `${title} 결석`, auto: true } })
    }
  }
  return items
}

function isActiveTeamLink(link) {
  return !Object.prototype.hasOwnProperty.call(link, 'status') || ['active', 'accepted'].includes(String(link.status || 'active'))
}

function contestJoinItemsForMember(memberId, teams = [], teamMembers = [], contestById = new Map()) {
  const activeTeamIds = new Set((teamMembers ?? [])
    .filter((link) => Number(link.member_id) === Number(memberId) && isActiveTeamLink(link))
    .map((link) => Number(link.team_id)))
  return (teams ?? [])
    .filter((team) => Number(team.leader_id) === Number(memberId) || activeTeamIds.has(Number(team.id)))
    .map((team) => {
      const contest = contestById.get(Number(team.contest_id))
      const title = contest?.title || team.introduction || `공모전 팀 #${team.id}`
      return {
        id: `contest-${team.id}`,
        event_type: 'contest_join',
        points: 1,
        metadata: { reason: `${title} 참여`, team_id: team.id, contest_id: team.contest_id, auto: true },
      }
    })
}
export { calculateActivityWeather, calculateWeatherFromEvents, gradeFor, weatherFor } from '../utils/activityWeather'
// eslint-disable-next-line no-unused-vars
const _legacyConsts = { OFFLINE_EVENT_TYPES, OFFLINE_TARGET_POINTS }

// 지도교수·고문은 활동날씨 산정 대상이 아닙니다.
const WEATHER_EXEMPT_TITLES = ['지도교수', '고문']
export function isWeatherExempt(member) {
  return WEATHER_EXEMPT_TITLES.includes(String(member?.position_title || '').trim())
}
function weatherExemptResult() {
  return {
    exempt: true, score: null, grade: '미적용', weatherType: 'collecting',
    message: '지도교수·고문은 활동날씨 대상이 아니에요.', isCollectingData: false,
    base: WEATHER_BASE_SCORE, totalDelta: 0, events: [],
  }
}

function testWeatherResultForMember(member) {
  const name = String(member?.name || '')
  if (!name.includes('[테스트]')) return null
  // 공백 무시 매칭 (예: "구름낀해" ↔ 프리셋 "구름낀 해")
  const nn = name.replace(/\s/g, '')
  const preset = ACTIVITY_WEATHER_PRESETS.find((item) => nn.includes(String(item.grade).replace(/\s/g, '')) || nn.includes(item.weatherType))
  if (!preset) return null
  return {
    score: Number(preset.score),
    grade: preset.grade,
    weatherType: preset.weatherType,
    message: preset.message,
    isCollectingData: false,
    base: WEATHER_BASE_SCORE,
    totalDelta: Number(preset.score) - WEATHER_BASE_SCORE,
    events: [],
    testWeather: true,
    raw: { testWeatherPreset: preset },
  }
}

// 에타 홍보 점수 계산 (promotion_member_progress_view)
function normalizePercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null
  const number = Number(value)
  return Math.min(100, Math.max(0, number <= 1 ? number * 100 : number))
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function calcPromotionScore(row) {
  if (!row) return null
  const directRate = firstNumber(row, [
    'completion_rate',
    'mission_completion_rate',
    'promotion_completion_rate',
    'progress_rate',
    'complete_rate',
    'completion_percent',
    'approved_rate',
    'verified_rate',
    'rate',
    'percentage',
  ])
  if (directRate !== null) return normalizePercent(directRate)

  const approved = firstNumber(row, [
    'approved_count',
    'verified_count',
    'certified_count',
    'confirmed_count',
    'success_count',
    'completed_count',
    'complete_count',
    'approved_mission_count',
    'verified_mission_count',
  ])
  const unapproved = firstNumber(row, [
    'unapproved_count',
    'unverified_count',
    'uncertified_count',
    'pending_count',
    'rejected_count',
    'failed_count',
    'not_approved_count',
  ])
  const target = firstNumber(row, [
    'target_count',
    'required_count',
    'total_count',
    'mission_count',
    'submitted_count',
    'submission_count',
    'all_count',
  ]) ?? (approved !== null && unapproved !== null ? approved + unapproved : null)

  if (approved !== null && target > 0) {
    return Math.min(100, (approved / target) * 100)
  }
  return null
}

// 오프라인 참여 점수 (activity_attendance_summary_view.attendance_rate 직접 사용)
function calcOfflineEventScore(events) {
  const verifiedEvents = (events ?? []).filter((event) => event.verified !== false && (!event.event_type || OFFLINE_EVENT_TYPES.includes(event.event_type) || event.event_type === 'offline'))
  if (!verifiedEvents.length) return null
  const points = verifiedEvents.reduce((sum, event) => sum + Number(event.score_delta ?? event.points ?? 0), 0)
  return normalizePercent(points / OFFLINE_TARGET_POINTS * 100)
}

function calcOfflineScore(row, events = []) {
  const attendanceScore = row?.attendance_rate === null || row?.attendance_rate === undefined ? null : normalizePercent(row.attendance_rate)
  const eventScore = calcOfflineEventScore(events)
  if (attendanceScore === null && eventScore === null) return null
  return Math.max(attendanceScore ?? 0, eventScore ?? 0)
}

// 출석 30점 = 오프라인 25점 + 온라인 5점 (모임 유형별 출석률 가중). 기본 점수 없이 실제 출석률로만 계산.
// 반환값은 0~100 스케일(calculateActivityWeather가 *30 적용). 출석 데이터가 없으면 null.
function calcAttendanceByMode(externalId, sessions, records) {
  if (externalId === null || externalId === undefined || externalId === '') return null
  const ext = String(externalId)
  const offlineSessions = (sessions ?? []).filter((s) => String(s.session_mode ?? 'offline') !== 'online')
  const onlineSessions = (sessions ?? []).filter((s) => String(s.session_mode) === 'online')
  if (!offlineSessions.length && !onlineSessions.length) return null
  const attended = new Set((records ?? [])
    .filter((r) => String(r.member_id) === ext && ['present', 'late', 'excused'].includes(String(r.status)))
    .map((r) => String(r.session_id)))
  const rateOf = (list) => list.length ? (list.filter((s) => attended.has(String(s.id))).length / list.length) * 100 : null
  const offlineRate = rateOf(offlineSessions)
  const onlineRate = rateOf(onlineSessions)
  if (offlineRate === null && onlineRate === null) return null
  const points = ((offlineRate ?? 0) / 100 * 25) + ((onlineRate ?? 0) / 100 * 5)
  return (points / 30) * 100
}

function targetsGeneration(targetGenerations, gen) {
  if (!targetGenerations) return false
  return String(targetGenerations).split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean).includes(gen)
}

// 신입 기수는 자기 기수 OT가 예정(미래)돼 있고 아직 안 열렸으면 출석을 기본치(100%)로 반영.
// OT 날짜가 지나면(과거 OT 존재) 실제 출석률로 전환. OT가 정의 안 된 기존 기수는 false.
function isPreOt(memberGeneration, sessions, now = Date.now()) {
  const gen = String(memberGeneration ?? '').replace(/[^0-9]/g, '')
  if (!gen) return false
  const otForGen = (sessions ?? []).filter((s) => s.is_orientation && targetsGeneration(s.target_generations, gen))
  if (!otForGen.length) return false
  const hasFuture = otForGen.some((s) => s.starts_at && new Date(s.starts_at).getTime() > now)
  const hasPast = otForGen.some((s) => s.starts_at && new Date(s.starts_at).getTime() <= now)
  return hasFuture && !hasPast
}

// 동료평가 점수 계산 (team_matching_peer_reviews)
function calcPeerReviewScore(reviews) {
  const approvedReviews = (reviews ?? []).filter(isApprovedPeerReview)
  if (!approvedReviews.length) return null
  const sum = approvedReviews.reduce((acc, r) => {
    const scores = [
      Number(r.participation ?? r.participation_score),
      Number(r.sincerity ?? r.sincerity_score),
      Number(r.collaboration ?? r.collaboration_score),
      Number(r.communication ?? r.communication_score),
      Number(r.contribution ?? r.contribution_score ?? parseContributionFromComment(r.comment)),
    ].filter((score) => Number.isFinite(score) && score > 0)
    const avg = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : 0
    return acc + avg
  }, 0)
  return (sum / approvedReviews.length / 5) * 100
}

function isApprovedPeerReview(review) {
  if (!review) return false
  if ('status' in review && review.status) return ['approved', 'accepted', 'verified'].includes(String(review.status))
  if ('approved' in review) return review.approved === true
  if ('is_approved' in review) return review.is_approved === true
  return true
}

function parseContributionFromComment(comment) {
  const match = String(comment || '').match(/\[기여도:(\d+)\]/)
  return match ? Number(match[1]) : null
}

/**
 * 특정 회원의 활동날씨 데이터 조회 및 계산
 * @param {{ id: number, mast_member_id: string }} member
 */
export async function getMemberActivityWeather(member) {
  const testWeather = testWeatherResultForMember(member)
  if (testWeather) return testWeather
  if (isWeatherExempt(member)) return { ...weatherExemptResult(), raw: {} }
  const supabase = requireSupabase()
  const memberId = member?.id ?? member  // 하위 호환

  // 70점 시작 + 관리자 가감점 + 출석(실시간) + 에타 미참여(마감 후 실시간)
  const [eventRes, legacyMember, sessionRes, missionRes, teamRes, teamMemberRes, contestRes] = await Promise.all([
    supabase.from(TABLES.scoreEvents).select('*').eq('member_id', memberId).eq('verified', true),
    findAttendanceMember(member).catch(() => null),
    supabase.from('activity_sessions').select('id,title,is_orientation'),
    supabase.from('promotion_missions').select('id,title,due_at'),
    supabase.from(TABLES.teams).select('id,contest_id,leader_id,introduction,status'),
    supabase.from(TABLES.teamMembers).select('id,team_id,member_id,status'),
    supabase.from(TABLES.contests).select('id,title'),
  ])
  const manual = (eventRes.data ?? []).filter((e) => !DERIVED_EVENT_TYPES.includes(e.event_type))
  let attendanceItems = []
  let promoItems = []
  const contestById = new Map((contestRes.data ?? []).map((contest) => [Number(contest.id), contest]))
  const contestItems = contestJoinItemsForMember(memberId, teamRes.data ?? [], teamMemberRes.data ?? [], contestById)
  if (legacyMember) {
    const [recRes, promoRes] = await Promise.all([
      supabase.from('activity_attendance_records').select('*').eq('member_id', legacyMember.id),
      supabase.from('promotion_mission_assignments').select('id,mission_id,status').eq('member_id', legacyMember.id),
    ])
    const sessionById = new Map((sessionRes.data ?? []).map((s) => [String(s.id), s]))
    const missionById = new Map((missionRes.data ?? []).map((m) => [String(m.id), m]))
    attendanceItems = attendanceItemsFromRecords(recRes.data ?? [], sessionById)
    promoItems = promotionMissItems(promoRes.data ?? [], missionById, Date.now())
  }

  return {
    ...calculateWeatherFromEvents([...manual, ...attendanceItems, ...promoItems, ...contestItems]),
    raw: { scoreEvents: eventRes.data ?? [], attendanceItems, promoItems, contestItems },
  }
}

/**
 * 전체 회원 활동날씨 일괄 계산 (관리자용)
 * @param {Array<{ id: number }>} members
 */
export async function getAllActivityWeather(members) {
  const supabase = requireSupabase()
  const [eventRes, recRes, sessionRes, legacyRes, promoAssignRes, missionRes, teamRes, teamMemberRes, contestRes] = await Promise.all([
    supabase.from(TABLES.scoreEvents).select('*').eq('verified', true),
    supabase.from('activity_attendance_records').select('*'),
    supabase.from('activity_sessions').select('id,title,is_orientation'),
    supabase.from('members').select(LEGACY_MEMBER_FIELDS),
    supabase.from('promotion_mission_assignments').select('id,mission_id,member_id,status'),
    supabase.from('promotion_missions').select('id,title,due_at'),
    supabase.from(TABLES.teams).select('id,contest_id,leader_id,introduction,status'),
    supabase.from(TABLES.teamMembers).select('id,team_id,member_id,status'),
    supabase.from(TABLES.contests).select('id,title'),
  ])
  const allEvents = eventRes.data ?? []
  const allRecords = recRes.data ?? []
  const legacyList = legacyRes.data ?? []
  const allPromo = promoAssignRes.data ?? []
  const sessionById = new Map((sessionRes.data ?? []).map((s) => [String(s.id), s]))
  const missionById = new Map((missionRes.data ?? []).map((m) => [String(m.id), m]))
  const contestById = new Map((contestRes.data ?? []).map((contest) => [Number(contest.id), contest]))
  const teams = teamRes.data ?? []
  const teamMembers = teamMemberRes.data ?? []
  const now = Date.now()

  return members.map((member) => {
    const testWeather = testWeatherResultForMember(member)
    if (testWeather) return { ...member, activityWeather: testWeather, testWeather: true, raw: testWeather.raw }
    if (isWeatherExempt(member)) {
      return { ...member, activityWeather: weatherExemptResult(), weatherExempt: true, raw: {} }
    }
    const manual = allEvents.filter((event) => Number(event.member_id) === Number(member.id) && !DERIVED_EVENT_TYPES.includes(event.event_type))
    const legacy = matchLegacyMember(member, legacyList)
    const recs = legacy ? allRecords.filter((r) => String(r.member_id) === String(legacy.id)) : []
    const promos = legacy ? allPromo.filter((a) => String(a.member_id) === String(legacy.id)) : []
    const attendanceItems = attendanceItemsFromRecords(recs, sessionById)
    const promoItems = promotionMissItems(promos, missionById, now)
    const contestItems = contestJoinItemsForMember(member.id, teams, teamMembers, contestById)
    return {
      ...member,
      activityWeather: calculateWeatherFromEvents([...manual, ...attendanceItems, ...promoItems, ...contestItems]),
      raw: { scoreEvents: manual, attendanceItems, promoItems, contestItems },
    }
  })
}

async function safeSelectPeerReviewSummary() {
  try {
    const result = await requireSupabase().from(TABLES.peerReviewSummary).select('*')
    if (result.error) return { data: [], error: null }
    return result
  } catch {
    return { data: [], error: null }
  }
}

function findPeerSummaryRow(rows = [], memberId) {
  return (rows ?? []).find((row) => Number(row.member_id ?? row.reviewee_id) === Number(memberId)) ?? null
}

function findPromotionRow(rows = [], member) {
  const memberId = member?.id ?? member
  const mastMemberId = member?.mast_member_id
  const candidates = [
    mastMemberId,
    memberId,
    member?.member_id,
    member?.user_id,
    member?.profile_id,
  ].filter((value) => value !== null && value !== undefined && value !== '').map(String)

  const idMatch = (rows ?? []).find((row) => {
    const rowCandidates = [
      row.member_id,
      row.mast_member_id,
      row.team_matching_member_id,
      row.member_integer_id,
      row.tm_member_id,
      row.user_id,
      row.profile_id,
    ].filter((value) => value !== null && value !== undefined && value !== '').map(String)
    return rowCandidates.some((value) => candidates.includes(value))
  })
  if (idMatch) return idMatch

  // 기존 회원 데이터에 mast_member_id가 비어 있는 경우에만 이름+학교로 보조 매칭합니다.
  // 동명이인 오연결을 막기 위해 두 값이 모두 일치해야 합니다.
  if (!mastMemberId && member?.name && member?.school) {
    return (rows ?? []).find((row) =>
      row.member_name === member.name && row.school === member.school
    ) ?? null
  }
  return null
}

function findAttendanceRow(rows = [], member, promotionRow) {
  const externalMemberId = member?.mast_member_id ?? promotionRow?.member_id
  if (!externalMemberId) return null
  return (rows ?? []).find((row) => String(row.member_id) === String(externalMemberId)) ?? null
}
