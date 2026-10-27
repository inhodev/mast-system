import { isPromotionTarget } from '../utils/promotionAssignmentPolicy.js'
import { useEffect, useRef } from 'react'
import { Bell, CalendarDays, ChevronRight, CloudSun, FileText, Megaphone, Trophy, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import useQuery from '../hooks/useQuery'
import { getOverview } from '../services/dataService'
import { LoadingState, ErrorState, EmptyState } from '../components/States'
import ActivityWeatherCard from '../components/ActivityWeatherCard'
import ActivityWeatherIcon from '../components/ActivityWeatherIcon'
import { getMemberActivityWeather } from '../services/activityWeatherService'
import { getPromotionDashboard, isPromotionSubmitted } from '../services/promotionService'
import { getActiveAttendanceSessions } from '../services/attendanceService'
import { formatDate, titleOf } from '../utils/display'
import { ADMIN_SECTIONS } from '../utils/adminSections'

export default function HomeScreen() {
  const { member, isExecOperator, adminSections } = useAuth()
  const { data, loading, error, warning, retry } = useQuery(() => getOverview(member.id), [member.id], {
    initialData: emptyOverview(),
  })
  const promotionQuery = useQuery(() => getPromotionDashboard(member), [member.id], {
    initialData: emptyPromotion(),
  })
  const attendanceQuery = useQuery(() => getActiveAttendanceSessions(), [member.id], {
    initialData: [],
  })
  const weatherQuery = useQuery(() => getMemberActivityWeather(member), [member.id])

  // 관리자가 점수·출석·공지 등을 수정하면 앱 복귀/탭 전환 시 자동으로 다시 불러와 반영
  const refreshRef = useRef(() => {})
  refreshRef.current = () => { retry && retry(); weatherQuery.retry && weatherQuery.retry(); attendanceQuery.retry && attendanceQuery.retry(); promotionQuery.retry && promotionQuery.retry() }
  useEffect(() => {
    const refresh = () => { if (!document.hidden) refreshRef.current() }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} retry={retry} />

  const teamIds = new Set(data.memberships.filter((m) => m.member_id === member.id && isActiveMembership(m)).map((m) => m.team_id))
  const myTeams = data.teams.filter((team) => teamIds.has(team.id) || team.leader_id === member.id)
  const myApps = data.applications.filter((application) => application.applicant_id === member.id && isVisibleApplication(application))
  const nextSchedule = getNextMemberSchedule({ myTeams, myApps, teams: data.teams, contests: data.contests })
  const promotionTodo = getPromotionTodo(promotionQuery.data, promotionQuery.warning)
  const openSessions = Array.isArray(attendanceQuery.data) ? attendanceQuery.data : []
  const attendanceTodo = openSessions.length ? {
    key: 'attendance',
    to: '/attendance',
    className: 'attendance',
    icon: CalendarDays,
    title: openSessions.length > 1 ? `출석 가능한 모임이 ${openSessions.length}건 있습니다` : `출석 가능한 모임이 있습니다`,
    description: `${openSessions[0]?.title || '모임'} · 지금 출석 체크할 수 있어요.`,
    action: '출석하기',
  } : null
  const todoItems = [promotionTodo, attendanceTodo].filter(Boolean)
  const quick = [
    ['/promotion', Megaphone, '홍보', '오늘 미션 확인과 인증', 'coral'],
    ['/attendance', CalendarDays, '출석', '모임 일정과 출석 체크', 'blue'],
    ['/contests', Trophy, '공모전', '공모전 메인으로 이동', 'violet'],
  ]
  const firstAdminSection = ADMIN_SECTIONS.find((s) => adminSections.includes(s.key))

  return <div className="mast-home">
    {(warning || data.unavailable?.length > 0) && <div className="partial-data-notice">DB 조회가 지연되거나 일부 테이블 권한이 막혀 기본 화면을 표시 중입니다.</div>}
    <section className="mast-home-hero mast-main-home-hero">
      <div className="mast-home-copy">
        <h1>안녕하세요,<br /><b>{member.name}</b>님</h1>
        <Link to="/my/teams" className="team-count-pill">참여 중인 팀 <strong>{myTeams.length}개</strong><ChevronRight /></Link>
      </div>
      <div className="mast-home-hero-weather" aria-hidden="true">
        <ActivityWeatherIcon weather={weatherQuery.data ?? { weatherType: 'collecting', grade: '확인 중' }} size="hero" />
      </div>
    </section>

    {data.announcements[0] && <Link to="/announcements" className="mast-home-notice-banner">
      <Bell />
      <span>공지</span>
      <b>{titleOf(data.announcements[0])}</b>
      <ChevronRight />
    </Link>}

    {todoItems.length > 0 && <section className="home-todo-card">
      <div className="mast-section-heading"><h2>오늘 할 일</h2><span className="todo-count">{todoItems.length}</span></div>
      {todoItems.map((item) => {
        const Icon = item.icon
        return <Link to={item.to} className={`todo-row ${item.className}`} key={item.key}>
          <span><Icon /></span>
          <div><b>{item.title}</b><p>{item.description}</p></div>
          <em>{item.action}</em>
        </Link>
      })}
    </section>}

    <section className="mast-quick-grid">
      {quick.map(([to, Icon, title, sub, color]) => <Link to={to} className="mast-quick-card" aria-label={`${title} 바로가기`} key={title}>
        <span className={`mast-quick-icon ${color}`}><Icon /></span>
        <div><h2>{title}</h2><p>{sub}</p></div>
        <ChevronRight />
      </Link>)}
    </section>

    <HomeWeather query={weatherQuery} />

    <section className="mast-status">
      <div className="mast-section-heading"><h2>주요 현황</h2><Link to="/my/teams">전체보기 <ChevronRight /></Link></div>
      <div className="mast-status-grid">
        <Link to="/my/teams"><span>참여 중인 팀</span><b>{myTeams.length}<small>개</small></b><UsersRound /></Link>
        <Link to="/my/applications"><span>내 지원 현황</span><b>{myApps.length}<small>건</small></b><small className="status-caption">{applicationStatusSummary(myApps)}</small><FileText /></Link>
        <Link to={nextSchedule?.to || '/my/teams'} className="my-schedule-card">
          <span>다가오는 내 일정</span>
          <strong>{nextSchedule?.title || '내 일정 없음'}</strong>
          <b className="deadline">{nextSchedule?.dDay || '-'}</b>
          <small>{nextSchedule?.caption || '참여 중인 팀이나 지원한 팀 기준으로 표시돼요.'}</small>
          <CalendarDays />
        </Link>
      </div>
    </section>

    <section className="mast-notice"><Bell /><b>공지사항</b><span>{data.announcements[0] ? titleOf(data.announcements[0]) : '등록된 공지가 없습니다.'}</span><ChevronRight /></section>

    {isExecOperator && <section className="mast-admin-access">
      <div className="mast-section-heading"><h2>관리자 기능</h2><Link to={firstAdminSection?.to || '/'}>관리자 기능 <ChevronRight /></Link></div>
      <div className="mast-quick-grid">
        {ADMIN_SECTIONS.filter((s) => adminSections.includes(s.key)).map((s) => {
          const Icon = s.Icon
          return <Link to={s.to} className="mast-quick-card" key={s.key}>
            <span className="mast-quick-icon violet"><Icon /></span>
            <div><h2>{s.label}</h2><p>허용된 관리자 기능</p></div>
            <ChevronRight />
          </Link>
        })}
      </div>
    </section>}
  </div>
}

function HomeWeather({ query: q }) {
  if (q.loading) return <div className="weather-card-skeleton" />
  if (q.error) return null
  return <ActivityWeatherCard data={q.data} compact />
}

function getPromotionTodo(promotion, warning) {
  if (warning) return null
  if (!promotion?.mission) return null
  const assignment = promotion.assignment
  const missionTitle = promotion.mission.title || '오늘 홍보 미션'
  // 홍보 대상자(배정된 회원)일 때만 "오늘 할 일"에 노출
  if (!isPromotionTarget(assignment)) return null
  if (isPromotionSubmitted(assignment.status)) {
    return {
      key: 'promotion-done',
      to: '/promotion',
      className: 'promotion',
      icon: Megaphone,
      title: '오늘 홍보 인증을 제출했습니다',
      description: `${missionTitle} 인증 사진을 다시 확인하거나 수정할 수 있어요.`,
      action: '사진 수정',
    }
  }
  return {
    key: 'promotion',
    to: '/promotion',
    className: 'promotion',
    icon: Megaphone,
    title: '오늘 홍보 대상자입니다',
    description: `${missionTitle} 게시글을 업로드하고 인증해주세요.`,
    action: '제출하기',
  }
}

function getNextMemberSchedule({ myTeams, myApps, teams, contests }) {
  const contestById = new Map(contests.map((contest) => [contest.id, contest]))
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const events = []

  myTeams.forEach((team) => {
    addContestEvents(events, team.contest || contestById.get(team.contest_id), '내 팀', '/my/teams')
  })

  myApps.forEach((application) => {
    const team = teamById.get(application.team_id)
    addContestEvents(events, team?.contest || contestById.get(team?.contest_id), '내 지원', '/my/applications')
  })

  return events.sort((a, b) => a.date.getTime() - b.date.getTime())[0] || null
}

function addContestEvents(events, contest, source, to) {
  if (!contest) return
  const labels = [
    ['접수마감', contest.registration_deadline],
    ['발표일', contest.presentation_date],
    ['해커톤', contest.hackathon_date],
  ]
  labels.forEach(([label, value]) => {
    const date = toUpcomingDate(value)
    if (!date) return
    events.push({
      date,
      to,
      title: titleOf(contest),
      caption: `${source} · ${label} ${formatDate(date)}`,
      dDay: toDday(date),
    })
  })
}

function toUpcomingDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date >= today ? date : null
}

function toDday(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'D-DAY'
  return `D-${diff}`
}

function isActiveMembership(membership) {
  return !membership.status || membership.status === 'active' || membership.status === 'accepted'
}

function isVisibleApplication(application) {
  return !application.status || ['pending', 'accepted', 'rejected'].includes(application.status)
}

function applicationStatusSummary(applications) {
  const pending = applications.filter((item) => item.status === 'pending').length
  const accepted = applications.filter((item) => item.status === 'accepted').length
  const rejected = applications.filter((item) => item.status === 'rejected').length
  return `검토 ${pending} · 승인 ${accepted} · 반려 ${rejected}`
}

function emptyOverview() {
  return { contests: [], teams: [], memberships: [], applications: [], announcements: [], notifications: [], unavailable: [] }
}

function emptyPromotion() {
  return { promotionMember: null, mission: null, assignment: null, proof: null, records: [], assignees: [] }
}
