import { promotionReminderTargets } from '../utils/promotionAssignmentPolicy.js'
import { TABLES, requireSupabase, throwIfError } from './baseService'
import { getNotifications } from './dataService'
import { todayKST } from './promotionService'

// ---------------------------------------------------------------------------
// 브라우저 알림 권한 / 포그라운드 푸시
// ---------------------------------------------------------------------------
const lastSeenKey = (id) => `mast_notif_last_seen_${id}`

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

// 사용자에게 알림 허용을 요청합니다. (이미 결정된 경우 현재 상태 반환)
export async function ensureNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function showPush(notification) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const push = new Notification(notification.title || 'MAST 알림', {
      body: notification.body || '',
      tag: `mast-${notification.id}`,
      icon: '/assets/mast-logo.webp',
      badge: '/assets/mast-logo.webp',
    })
    push.onclick = () => {
      try { window.focus() } catch { /* noop */ }
      if (notification.href) window.location.assign(notification.href)
      push.close()
    }
  } catch {
    /* 일부 환경에서 Notification 생성이 막혀 있어도 앱은 정상 동작해야 함 */
  }
}

// 새 알림이 도착하면 브라우저 푸시로 띄우는 폴링 워처.
// 앱(탭)이 열려 있는 동안 동작합니다. 정리(cleanup) 함수를 반환합니다.
export function startNotificationWatcher(memberId, { intervalMs = 45000, onNew } = {}) {
  if (!memberId) return () => {}
  let stopped = false
  let timer = null
  const seenKey = lastSeenKey(memberId)
  const getLastSeen = () => Number(localStorage.getItem(seenKey) || 0)
  const setLastSeen = (id) => localStorage.setItem(seenKey, String(id))

  async function tick(initial) {
    if (stopped) return
    try {
      const rows = await getNotifications(memberId, 20)
      const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
      const lastSeen = getLastSeen()
      if (initial && lastSeen === 0) {
        // 첫 실행이면 기존 알림은 푸시하지 않고 기준점만 저장
        setLastSeen(maxId)
      } else {
        const fresh = rows
          .filter((row) => Number(row.id) > lastSeen)
          .sort((a, b) => Number(a.id) - Number(b.id))
        if (fresh.length) {
          fresh.forEach(showPush)
          if (onNew) onNew(fresh)
        }
        if (maxId > lastSeen) setLastSeen(maxId)
      }
    } catch {
      /* 네트워크 오류는 조용히 무시하고 다음 주기에 재시도 */
    }
    if (!stopped) timer = setTimeout(() => tick(false), intervalMs)
  }

  tick(true)
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}

// ---------------------------------------------------------------------------
// 알림 생성 (관리자 트리거)
// ---------------------------------------------------------------------------

// 출석 모임이 시작되어 출석 체크가 필요할 때: 전체 회원에게 알림
// OneSignal Edge Function 호출 → 앱을 닫아도 오는 푸시 발송. 실패해도 알림 생성은 막지 않음.
// Supabase Edge Function 슬러그 (대시보드에서 만든 함수 이름)
const PUSH_FUNCTION = 'smooth-service'
export async function sendOneSignalPush({ memberIds, all, title, body, url } = {}) {
  try {
    const client = requireSupabase()
    await client.functions.invoke(PUSH_FUNCTION, { body: { memberIds, all, title, body, url } })
  } catch { /* 발송 함수 미배포/오류여도 무시 */ }
}

const FULL_ADMIN_ROLES = ['admin', 'manager', 'professor']

function normalizeAdminSections(value) {
  let arr = value
  if (typeof value === 'string') {
    try { arr = JSON.parse(value) } catch { arr = [] }
  }
  return Array.isArray(arr) ? arr.map(String) : []
}

export async function getAdminNotificationRecipientIds(client, section) {
  try {
    const { data, error } = await client
      .from(TABLES.members)
      .select('id,role,admin_sections')
    if (error) throw error
    return [...new Set((data ?? [])
      .filter((member) => FULL_ADMIN_ROLES.includes(member.role) || (section && normalizeAdminSections(member.admin_sections).includes(section)))
      .map((member) => member.id)
      .filter(Boolean))]
  } catch {
    const { data } = await client.from(TABLES.members).select('id,role').in('role', FULL_ADMIN_ROLES)
    return [...new Set((data ?? []).map((member) => member.id).filter(Boolean))]
  }
}

// 전체 관리자 + 해당 섹션 권한을 받은 회원에게 알림 + 푸시
export async function notifyAdmins({ title, body, href, section } = {}) {
  try {
    const client = requireSupabase()
    const ids = await getAdminNotificationRecipientIds(client, section)
    if (!ids.length) return
    await client.from(TABLES.notifications).insert(ids.map((id) => ({ member_id: id, type: 'notice', title, body, href })))
    await sendOneSignalPush({ memberIds: ids, title, body, url: href })
  } catch { /* 무시 */ }
}

export async function notifyAttendanceOpen(session) {
  const client = requireSupabase()
  const title = session?.title || '모임'
  const { error } = await client.from(TABLES.notifications).insert({
    member_id: null,
    type: 'attendance',
    title: '출석체크가 시작되었습니다',
    body: `${title} 출석을 진행해 주세요.`,
    href: '/attendance',
  })
  throwIfError(error)
  await sendOneSignalPush({ all: true, title: '출석체크가 시작되었습니다', body: `${title} 출석을 진행해 주세요.`, url: '/attendance' })
  return true
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}
function generationNumber(value) {
  return String(value ?? '').replace(/[^0-9]/g, '')
}

// 홍보(legacy: members 테이블) 대상자를 로그인 계정(team_matching_members)에 매칭
function matchTeamMatchingMember(assignee, members) {
  const name = normalizeKey(assignee.member_name ?? assignee.name)
  const school = normalizeKey(assignee.school)
  const gen = generationNumber(assignee.gi ?? assignee.generation)
  // 1순위: 이름+기수+학교, 2순위: 이름+학교, 3순위: 이름
  return (
    members.find((m) => normalizeKey(m.name) === name && (!gen || generationNumber(m.generation) === gen) && (!school || normalizeKey(m.school) === school))
    || members.find((m) => normalizeKey(m.name) === name && (!school || normalizeKey(m.school) === school))
    || members.find((m) => normalizeKey(m.name) === name)
    || null
  )
}

// 오늘 홍보 미션 대상자에게 알림 보내기 (관리자 페이지 버튼)
// mission / assignees 를 넘기면 재조회 없이 사용합니다.
export async function notifyPromotionTargets({ mission, assignees } = {}) {
  const client = requireSupabase()
  const today = todayKST()

  let resolvedMission = mission
  if (!resolvedMission) {
    const { data } = await client.from('promotion_missions').select('*').eq('mission_date', today).maybeSingle()
    resolvedMission = data || null
  }
  if (!resolvedMission) throw new Error('오늘 등록된 홍보 미션이 없습니다.')

  let resolvedAssignees = assignees
  if (!resolvedAssignees) {
    const { data, error } = await client
      .from('promotion_assignment_status_view')
      .select('member_id,member_name,gi,school,status')
      .eq('mission_id', resolvedMission.id)
    throwIfError(error)
    resolvedAssignees = data || []
  }
  if (!resolvedAssignees.length) throw new Error('오늘 홍보 대상자가 없습니다.')

  // 미제출자에게만 발송: 제출/승인/지각완료 상태는 제외
  const pending = promotionReminderTargets(resolvedAssignees)
  if (!pending.length) throw new Error('미제출자가 없습니다. 대상자 전원이 인증을 완료했어요.')

  const { data: members, error: memberError } = await client
    .from(TABLES.members)
    .select('id,name,school,generation')
  throwIfError(memberError)

  const rows = []
  const unmatched = []
  const missionTitle = resolvedMission.title || '오늘 홍보 미션'
  pending.forEach((assignee) => {
    const matched = matchTeamMatchingMember(assignee, members || [])
    if (matched) {
      rows.push({
        member_id: matched.id,
        type: 'promotion_target',
        title: '홍보 인증 미제출 안내',
        body: `${missionTitle} — 아직 인증을 제출하지 않았어요. 오늘 안에 게시글을 올리고 인증해 주세요.`,
        href: '/promotion',
      })
    } else {
      unmatched.push(assignee.member_name ?? assignee.name)
    }
  })

  if (rows.length) {
    const { error: insertError } = await client.from(TABLES.notifications).insert(rows)
    throwIfError(insertError)
    await sendOneSignalPush({
      memberIds: rows.map((r) => r.member_id),
      title: '홍보 인증 미제출 안내',
      body: `${missionTitle} — 아직 인증을 제출하지 않았어요. 오늘 안에 인증해 주세요.`,
      url: '/promotion',
    })
  }
  return { sent: rows.length, unmatched }
}
