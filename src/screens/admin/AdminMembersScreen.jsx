import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Check, ChevronRight, Home, Megaphone, ShieldCheck, SlidersHorizontal, Trash2, Trophy } from 'lucide-react'
import ActivityWeatherIcon from '../../components/ActivityWeatherIcon'
import Modal from '../../components/Modal'
import MemberPasswordReset from '../../components/MemberPasswordReset'
import { Field, FormActions } from '../../components/FormControls'
import { ErrorState, LoadingState } from '../../components/States'
import useQuery from '../../hooks/useQuery'
import { useAuth } from '../../context/AuthContext'
import { createScoreEvent, deleteAdminMember, deleteScoreEvent, getAdminMemberStatsRows, getMemberAdminSections, getMemberPositions, updateMemberAdminFields, updateScoreEvent } from '../../services/adminService'
import { SCORE_RUBRIC } from '../../utils/activityWeather'
import { ADMIN_SECTIONS, normalizeSections } from '../../utils/adminSections'
import memberSchools from '../../data/member-schools.json'

const GAINS = SCORE_RUBRIC.filter((item) => item.group === 'gain')
const DEDUCTS = SCORE_RUBRIC.filter((item) => item.group === 'deduct')
const EXEC_DEPARTMENTS = [
  '홍보기획팀',
  '개발운영팀',
  '경영전략팀',
  '교육운영팀',
  '데이터리서치팀',
  '디자인기획팀',
  '사업운영팀',
  '대외협력팀',
  '소셜아카이브팀',
  '크리에이티브팀',
  '피플팀',
]
const EXEC_STANDALONE_TITLES = ['회장', '부회장']
const EXEC_RANKS = ['팀장', '부팀장', '팀원']
const PRIVILEGED_POSITION_TYPES = ['exec', 'professor', 'advisor']

const roleLabels = {
  member: '회원',
  manager: '운영진',
  admin: '관리자',
  professor: '교수',
}

export default function AdminMembersScreen() {
  const { isFullAdmin } = useAuth()
  const q = useQuery(async () => {
    const [rows, positions, sectionMap] = await Promise.all([getAdminMemberStatsRows(), getMemberPositions(), getMemberAdminSections()])
    return rows.map((row) => ({ ...row, position_title: positions[row.id] ?? row.position_title ?? null, admin_sections: sectionMap[row.id] ?? row.admin_sections ?? [] }))
  }, [])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  // 일괄 점수 부여
  const [scoreMode, setScoreMode] = useState(false)
  const [selKey, setSelKey] = useState(null)
  const [customReason, setCustomReason] = useState('')
  const [customPoints, setCustomPoints] = useState('')
  const [checked, setChecked] = useState(() => new Set())
  const [applying, setApplying] = useState(false)

  if (q.loading && !q.data) return <LoadingState />
  if (q.error && !q.data) return <ErrorState error={q.error} retry={q.retry} />
  const mainHref = isFullAdmin ? '/admin' : '/'
  const mainLabel = isFullAdmin ? '관리자 홈으로' : '회원 홈으로'

  const keyword = search.trim().toLowerCase()
  const rows = (q.data ?? []).filter((row) => {
    if (!keyword) return true
    return `${row.name} ${row.school} ${row.major} ${row.generation} ${row.position_title || ''} ${roleLabels[row.role] || row.role}`.toLowerCase().includes(keyword)
  }).sort(compareMembers)

  const activeItem = selKey === 'custom'
    ? (customPoints !== '' && !Number.isNaN(Number(customPoints)) ? { key: 'manual', label: customReason.trim() || '수동 조정', points: Number(customPoints) } : null)
    : SCORE_RUBRIC.find((r) => r.key === selKey) || null

  const toggleCheck = (id) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const exitScoreMode = () => { setScoreMode(false); setSelKey(null); setChecked(new Set()); setCustomReason(''); setCustomPoints('') }

  const applyBulk = async () => {
    if (!activeItem || !checked.size) return
    setApplying(true); setNotice('')
    try {
      const ids = [...checked]
      for (const id of ids) {
        await createScoreEvent({ member_id: id, event_type: activeItem.key, points: activeItem.points, reason: activeItem.label })
      }
      setNotice(`${ids.length}명에게 "${activeItem.label}" ${activeItem.points > 0 ? '+' : ''}${activeItem.points}점을 반영했습니다.`)
      setChecked(new Set())
      q.retry()
    } catch (e) {
      setNotice(`점수 반영 실패: ${e.message}`)
    } finally {
      setApplying(false)
    }
  }

  return <div className="admin-member-list-page">
    {notice && <div className="form-notice">{notice}</div>}

    <section className="admin-member-list-panel">
      <header>
        <div className="admin-member-header-title">
          <Link className="admin-icon-button mini" to={mainHref} aria-label={mainLabel}><Home /></Link>
          <div>
            <h1>회원 관리</h1>
            <p>회원을 선택하면 출결, 홍보, 공모전, 활동날씨와 직책을 확인할 수 있습니다. 임원진이 먼저, 그 다음 기수·이름·학교 순으로 정렬됩니다.</p>
          </div>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름, 학교, 기수 검색" />
        <button type="button" className={`button ${scoreMode ? 'secondary' : 'primary'} bulk-score-toggle`} onClick={() => (scoreMode ? exitScoreMode() : setScoreMode(true))}>
          <SlidersHorizontal size={15} /> {scoreMode ? '일괄 점수 닫기' : '일괄 점수 부여'}
        </button>
      </header>

      {scoreMode && <div className="bulk-score-panel">
        <div className="bulk-score-step"><span className="bulk-step-num">1</span> 항목 선택</div>
        <div className="rubric-buttons">
          {GAINS.map((item) => <button key={item.key} type="button" className={`rubric-btn gain${selKey === item.key ? ' active' : ''}`} onClick={() => setSelKey(item.key)}>{item.label}<span>+{item.points}</span></button>)}
          {DEDUCTS.map((item) => <button key={item.key} type="button" className={`rubric-btn deduct${selKey === item.key ? ' active' : ''}`} onClick={() => setSelKey(item.key)}>{item.label}<span>{item.points}</span></button>)}
          <button type="button" className={`rubric-btn${selKey === 'custom' ? ' active' : ''}`} onClick={() => setSelKey('custom')}>직접 입력</button>
        </div>
        {selKey === 'custom' && <div className="rubric-custom">
          <input type="text" placeholder="사유 (예: 임원진 가산)" value={customReason} onChange={(e) => setCustomReason(e.target.value)} />
          <input type="number" placeholder="점수 (±)" value={customPoints} onChange={(e) => setCustomPoints(e.target.value)} />
        </div>}
        <div className="bulk-score-step"><span className="bulk-step-num">2</span> 회원 선택 후 적용 (아래 목록에서 탭하여 선택)</div>
        <div className="bulk-score-actionbar">
          <span>선택 <b>{checked.size}</b>명{activeItem ? ` · ${activeItem.label} ${activeItem.points > 0 ? '+' : ''}${activeItem.points}` : ''}</span>
          <button type="button" className="button primary" disabled={applying || !activeItem || !checked.size} onClick={applyBulk}>
            {applying ? '반영 중...' : '선택 회원에 적용'}
          </button>
        </div>
      </div>}

      <div className={`admin-member-thin-list${scoreMode ? ' selecting' : ''}`}>
        {rows.length ? rows.map((row) => <button type="button" key={row.id} className={scoreMode && checked.has(row.id) ? 'is-checked' : ''} onClick={() => (scoreMode ? toggleCheck(row.id) : setSelected(row))}>
          {scoreMode && <span className="bulk-check">{checked.has(row.id) ? <Check size={14} /> : null}</span>}
          <div className={avatarClass(row)}>{initialOf(row.name)}</div>
          <div>
            <b>{row.name || '-'}{roleTitle(row) && <span className={`exec-title-inline${memberKind(row) === 'advisor' ? ' advisor' : ''}`}>{roleTitle(row)}</span>}</b>
            <small>{row.school || '-'} · {formatGeneration(row.generation)}</small>
          </div>
          {!scoreMode && <ChevronRight />}
        </button>) : <div className="admin-empty-card">표시할 회원이 없습니다.</div>}
      </div>
    </section>

    {selected && <MemberDetailModal
      member={(q.data ?? []).find((r) => r.id === selected.id) ?? selected}
      onClose={() => setSelected(null)}
      onSaved={(message) => {
        setNotice(message)
        setSelected(null)
        q.retry()
      }}
      onScoreChanged={q.retry}
    />}
  </div>
}

function MemberDetailModal({ member, onClose, onSaved, onScoreChanged }) {
  const { isFullAdmin } = useAuth()
  const initialExecPosition = parseExecPosition(member.position_title)
  const [name, setName] = useState(member.name || '')
  const [school, setSchool] = useState(member.school || '')
  const [major, setMajor] = useState(member.major || '')
  const [generation, setGeneration] = useState(member.generation || '')
  const [memberType, setMemberType] = useState(() => {
    const t = String(member.position_title || '').trim()
    if (t === '지도교수') return 'professor'
    if (t === '고문') return 'advisor'
    if (t) return 'exec'
    return 'member'
  })
  const [execDepartment, setExecDepartment] = useState(initialExecPosition.department)
  const [execRank, setExecRank] = useState(initialExecPosition.rank)
  const [sections, setSections] = useState(() => normalizeSections(member.admin_sections))
  const toggleSection = (key) => setSections((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canConfigureAdminSections = PRIVILEGED_POSITION_TYPES.includes(memberType)

  const save = async (event) => {
    event.preventDefault()
    const isStandaloneExecTitle = EXEC_STANDALONE_TITLES.includes(execDepartment)
    if (memberType === 'exec' && (!execDepartment || (!isStandaloneExecTitle && !execRank))) {
      setError('임원진 직책 또는 소속 팀과 직급을 선택해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // role(관리자 접근 권한)은 그대로 두고, 직책은 position_title 로만 관리
      // status 는 team_matching_members 에 컬럼이 없어 저장하지 않습니다.
      const execTitle = isStandaloneExecTitle ? execDepartment : `${execDepartment} ${execRank}`.trim()
      const titleByType = { member: null, exec: execTitle, professor: '지도교수', advisor: '고문' }
      const nextTitle = titleByType[memberType] ?? null
      // 임원진/지도교수/고문일 때만 직책별 관리자 권한 저장, 그 외에는 권한 회수([])
      const nextSections = canConfigureAdminSections ? sections : []
      await updateMemberAdminFields(member.id, { name, school, major, generation, position_title: nextTitle, admin_sections: nextSections })
      onSaved('회원 정보를 저장했습니다.')
    } catch (err) {
      const message = /admin_sections/.test(String(err.message))
        ? '관리자 권한 저장에 실패했습니다. Supabase에서 add-admin-sections.sql 을 실행해 admin_sections 컬럼을 추가해 주세요.'
        : /position_title/.test(String(err.message))
        ? '직책 저장에 실패했습니다. Supabase에서 add-position-title.sql 을 실행해 position_title 컬럼을 추가해 주세요.'
        : err.message
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`${member.name || '회원'} 정보를 삭제할까요? 연결된 지원/팀 데이터가 있으면 DB에서 삭제가 거절될 수 있습니다.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteAdminMember(member.id)
      onSaved('회원 정보를 삭제했습니다.')
    } catch (err) {
      setError(err.message || '회원 삭제에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={`${member.name || '회원'} 상세`} onClose={onClose} wide>
    <div className="admin-member-detail">
      <section>
        <div className="admin-member-profile-line">
          <div className={avatarClass(member, true)}>{initialOf(member.name)}</div>
          <div>
            <b>{member.name || '-'}{roleTitle(member) && <span className={`role-badge ${memberKind(member) === 'advisor' ? 'advisor' : 'exec'}`}><ShieldCheck size={12} /> {roleTitle(member)}</span>}</b>
            <small>{member.school || '-'} · {member.major || '전공 미정'} · {formatGeneration(member.generation)}</small>
          </div>
        </div>
        <div className="admin-member-detail-grid">
          <InfoCard icon={CalendarCheck} label="출결" value={attendanceLabel(member.attendanceSummary)} note={`기록 ${member.attendanceRecords?.length ?? 0}건 · OT 전 기본 점수 반영`} />
          <InfoCard icon={Megaphone} label="홍보" value={promotionLabel(member.promotionData)} note={promotionSub(member.promotionData)} />
          <InfoCard icon={Trophy} label="공모전" value={`${member.teamCount ?? 0}팀`} note={`지원 ${member.applicationCount ?? 0}건 · 대기 ${member.pendingApplicationCount ?? 0}건`} />
          {member.activityWeather?.exempt || memberKind(member) === 'advisor'
            ? <div className="admin-member-weather-card"><div><b>미적용</b><small>지도교수·고문</small></div></div>
            : <div className="admin-member-weather-card">
              <ActivityWeatherIcon weather={member.activityWeather} size="small" />
              <div><b>{member.activityWeather?.score ?? 0}점</b><small>{member.activityWeather?.grade || '-'}</small></div>
            </div>}
        </div>

        {!(member.activityWeather?.exempt || memberKind(member) === 'advisor') && (
          <MemberScorePanel member={member} onChange={onScoreChanged} />
        )}

        <div className="admin-member-related">
          <RelatedSection
            title="출석 내역"
            rows={member.attendanceRecords}
            empty="아직 출석 기록이 없습니다."
            render={(row) => <>
              <b>{row.session?.title || `모임 #${row.session_id}`}</b>
              <small>{formatDate(row.session?.starts_at || row.checked_at)} · {statusLabel(row.status)}</small>
            </>}
          />
          <RelatedSection
            title="홍보 인증 내역"
            rows={member.promotionProofs?.length ? member.promotionProofs : member.promotionAssignments}
            empty="홍보 인증 내역이 없습니다."
            render={(row) => <>
              <b>{row.mission_title || row.title || row.member_name || '홍보 미션'}</b>
              <small>{formatDate(row.mission_date || row.submitted_at || row.created_at)} · {statusLabel(row.status)}</small>
            </>}
          />
          <RelatedSection
            title="공모전 참여/지원"
            rows={[...(member.contestTeams ?? []), ...(member.contestApplications ?? [])]}
            empty="공모전 참여 내역이 없습니다."
            render={(row) => <>
              <b>{row.contest?.title || row.team?.introduction || row.introduction || '공모전 팀'}</b>
              <small>{row.role || row.survey_role || '지원'} · {statusLabel(row.status)}</small>
            </>}
          />
          <RelatedSection
            title="동료 평가"
            rows={member.peerReviews}
            empty="동료평가 내역이 없습니다."
            render={(row) => <>
              <b>{row.comment ? truncate(row.comment, 34) : `팀 #${row.team_id || '-'}`}</b>
              <small>참여 {row.participation ?? row.participation_score ?? '-'} · 책임 {row.sincerity ?? row.sincerity_score ?? '-'} · 소통 {row.communication ?? row.communication_score ?? '-'}</small>
            </>}
          />
        </div>
      </section>

      <form className="data-form" onSubmit={save}>
        {isFullAdmin && <MemberPasswordReset key={member.id} member={member} />}
        <Field label="이름">
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="학교">
          <select aria-label="학교·캠퍼스 선택" value={school} required onChange={(event) => setSchool(event.target.value)}>
            <option value="" disabled>학교·캠퍼스를 선택하세요</option>
            {school && !memberSchools.includes(school) && <option value={school}>{school} (현재 등록)</option>}
            {memberSchools.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <Field label="기수">
          <input value={generation} onChange={(event) => setGeneration(event.target.value)} placeholder="예: 3" />
        </Field>
        <Field label="전공">
          <input value={major} onChange={(event) => setMajor(event.target.value)} />
        </Field>
        <Field label="직책">
          <select value={memberType} onChange={(event) => setMemberType(event.target.value)}>
            <option value="member">회원</option>
            <option value="exec">임원진</option>
            <option value="professor">지도교수</option>
            <option value="advisor">고문</option>
          </select>
        </Field>
        {memberType === 'exec' && <Field label="임원진 직책/소속 팀">
          <select value={execDepartment} onChange={(event) => setExecDepartment(event.target.value)}>
            <option value="">직책 또는 팀 선택</option>
            <optgroup label="대표 직책">
              {EXEC_STANDALONE_TITLES.map((title) => <option value={title} key={title}>{title}</option>)}
            </optgroup>
            <optgroup label="팀">
            {EXEC_DEPARTMENTS.map((department) => <option value={department} key={department}>{department}</option>)}
            </optgroup>
          </select>
        </Field>}
        {memberType === 'exec' && !EXEC_STANDALONE_TITLES.includes(execDepartment) && <Field label="임원진 직급">
          <select value={execRank} onChange={(event) => setExecRank(event.target.value)}>
            <option value="">직급 선택</option>
            {EXEC_RANKS.map((rank) => <option value={rank} key={rank}>{rank}</option>)}
          </select>
        </Field>}
        {canConfigureAdminSections && <Field label="관리자 권한 (직책별 기능 제한)">
          <div className="admin-section-perms">
            {ADMIN_SECTIONS.map((s) => {
              const on = sections.includes(s.key)
              return <button type="button" key={s.key} className={`admin-section-chip${on ? ' on' : ''}`} onClick={() => toggleSection(s.key)}>
                {on && <Check size={13} />}{s.label}
              </button>
            })}
          </div>
          <small className="admin-section-perms-hint">체크한 기능만 이 회원의 회원 홈·관리자 콘솔에 표시됩니다. 비워두면 관리자 기능 없이 직책만 부여됩니다.</small>
        </Field>}
        <div className="admin-role-note"><ShieldCheck /> 임원진·지도교수·고문은 회원 로그인 그대로 두고, 체크한 관리자 기능만 회원 홈과 관리자 콘솔에서 사용할 수 있어요. 지도교수·고문은 파란색, 임원진은 노랑·하늘색 테두리로 표시됩니다.</div>
        {error && <div className="form-error">{error}</div>}
        <FormActions submitting={busy} submitLabel="회원 정보 저장" onCancel={onClose} />
        <button className="button danger admin-delete-member-button" type="button" onClick={remove} disabled={busy}>
          <Trash2 /> 회원 삭제
        </button>
      </form>
    </div>
  </Modal>
}

function MemberScorePanel({ member, onChange }) {
  const aw = member.activityWeather || {}
  const events = aw.events ?? []
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [customPoints, setCustomPoints] = useState('')

  const run = async (fn, msg) => {
    setBusy(true); setNotice('')
    try { await fn(); setNotice(msg); if (onChange) await onChange() }
    catch (e) { setNotice(`실패: ${e.message}`) }
    finally { setBusy(false) }
  }

  return <section className="admin-member-score-panel">
    <div className="member-score-summary">
      <span>시작 {aw.base ?? 70}</span>
      <span className={(aw.totalDelta ?? 0) >= 0 ? 'up' : 'down'}>가감 {(aw.totalDelta ?? 0) >= 0 ? '+' : ''}{aw.totalDelta ?? 0}</span>
      <b>{aw.score ?? 0}<small>/100</small> · {aw.grade || '-'}</b>
    </div>
    {notice && <div className="member-score-notice">{notice}</div>}
    <div className="rubric-buttons">
      {GAINS.map((it) => <button key={it.key} type="button" className="rubric-btn gain" disabled={busy} onClick={() => run(() => createScoreEvent({ member_id: member.id, event_type: it.key, points: it.points, reason: it.label }), `${it.label} +${it.points} 반영`)}>{it.label}<span>+{it.points}</span></button>)}
      {DEDUCTS.map((it) => <button key={it.key} type="button" className="rubric-btn deduct" disabled={busy} onClick={() => run(() => createScoreEvent({ member_id: member.id, event_type: it.key, points: it.points, reason: it.label }), `${it.label} ${it.points} 반영`)}>{it.label}<span>{it.points}</span></button>)}
    </div>
    <div className="rubric-custom">
      <input type="text" placeholder="사유 (예: 임원진 가산)" value={customReason} onChange={(e) => setCustomReason(e.target.value)} />
      <input type="number" placeholder="±점수" value={customPoints} onChange={(e) => setCustomPoints(e.target.value)} />
      <button type="button" className="button primary" disabled={busy || customPoints === '' || Number.isNaN(Number(customPoints))} onClick={() => { run(() => createScoreEvent({ member_id: member.id, event_type: 'manual', points: Number(customPoints), reason: customReason.trim() || '수동 조정' }), '수동 점수를 추가했습니다.'); setCustomReason(''); setCustomPoints('') }}>추가</button>
    </div>
    <div className="score-event-list">
      {!events.length && <p className="score-empty">아직 반영된 점수가 없습니다.</p>}
      {events.map((ev) => <MemberScoreRow key={ev.id} ev={ev} busy={busy} onEdit={(id, p) => run(() => updateScoreEvent(id, { points: p }), '점수를 수정했습니다.')} onDelete={(id) => run(() => deleteScoreEvent(id), '항목을 삭제했습니다.')} />)}
    </div>
  </section>
}

function MemberScoreRow({ ev, busy, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(ev.points))
  return <div className="score-event-row">
    <b>{ev.label}{ev.auto && <small>자동 반영</small>}</b>
    {editing ? <span className="score-event-edit">
      <input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" className="table-button" disabled={busy} onClick={() => { onEdit(ev.id, Number(value)); setEditing(false) }}>저장</button>
      <button type="button" className="table-button" onClick={() => { setValue(String(ev.points)); setEditing(false) }}>취소</button>
    </span> : <>
      <em className={ev.points >= 0 ? 'up' : 'down'}>{ev.points >= 0 ? '+' : ''}{ev.points}</em>
      {!ev.auto && <button type="button" className="table-button" disabled={busy} onClick={() => setEditing(true)}>수정</button>}
      {!ev.auto && <button type="button" className="table-button danger" disabled={busy} onClick={() => onDelete(ev.id)}><Trash2 size={13} /></button>}
    </>}
  </div>
}

function InfoCard({ icon: Icon, label, value, note }) {
  return <article className="admin-member-info-card"><Icon /><div><span>{label}</span><b>{value}</b><small>{note}</small></div></article>
}

const ADVISOR_TITLES = ['지도교수', '고문']
function parseExecPosition(value) {
  const title = String(value || '').trim()
  if (!title || ADVISOR_TITLES.includes(title)) return { department: '', rank: '' }
  if (EXEC_STANDALONE_TITLES.includes(title)) return { department: title, rank: '' }
  const department = EXEC_DEPARTMENTS.find((item) => title === item || title.startsWith(`${item} `)) || ''
  const rank = department ? title.slice(department.length).trim() : ''
  return {
    department,
    rank: EXEC_RANKS.includes(rank) ? rank : '',
  }
}
// 직책 분류: advisor(지도교수·고문, 파란 그라데) / exec(임원진, 노랑·하늘 그라데) / member
function memberKind(member) {
  const t = String(member?.position_title || '').trim()
  if (ADVISOR_TITLES.includes(t)) return 'advisor'
  if (t) return 'exec'
  return 'member'
}
function roleTitle(member) {
  return String(member?.position_title || '').trim()
}
function avatarClass(member, large = false) {
  const kind = memberKind(member)
  const ring = kind === 'advisor' ? ' is-advisor' : kind === 'exec' ? ' is-exec' : ''
  return `member-mini-avatar${large ? ' large' : ''}${ring}`
}

function isTestMember(m) {
  return String(m?.name || '').includes('[테스트]')
}

// 기본 정렬: [테스트] 회원은 항상 맨 아래 → 지도교수·고문 먼저 → 임원진 → 기수순 → 이름 → 학교
function compareMembers(a, b) {
  const at = isTestMember(a), bt = isTestMember(b)
  if (at !== bt) return at ? 1 : -1
  const rank = (m) => { const k = memberKind(m); return k === 'advisor' ? 0 : k === 'exec' ? 1 : 2 }
  const aRank = rank(a)
  const bRank = rank(b)
  if (aRank !== bRank) return aRank - bRank
  const aGen = genNumber(a.generation)
  const bGen = genNumber(b.generation)
  if (aGen !== bGen) return aGen - bGen
  const nameCmp = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
  if (nameCmp !== 0) return nameCmp
  return String(a.school || '').localeCompare(String(b.school || ''), 'ko')
}

function genNumber(value) {
  const n = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 9999
}

function initialOf(name) {
  return String(name || '?').trim().slice(0, 1)
}

function formatGeneration(value) {
  const text = String(value ?? '').trim()
  if (!text) return '기수 미정'
  return text.includes('기') ? text : `${text}기`
}

function RelatedSection({ title, rows = [], empty, render }) {
  const visibleRows = (rows ?? []).filter(Boolean).slice(0, 8)
  return <section className="admin-member-related-section">
    <h3>{title}</h3>
    {visibleRows.length ? visibleRows.map((row, index) => <article key={row.id ?? `${title}-${index}`}>
      {render(row)}
    </article>) : <p>{empty}</p>}
  </section>
}

function attendanceLabel(row) {
  const rate = firstNumber(row, ['attendance_rate', 'present_rate', 'completion_rate'])
  if (rate !== null) return `${formatPercent(rate)}`
  const present = firstNumber(row, ['present_count', 'attended_count'])
  const total = firstNumber(row, ['total_count', 'session_count', 'target_count'])
  if (present !== null && total) return `${present}/${total}`
  return '기본'
}

function promotionLabel(row) {
  const rate = firstNumber(row, ['completion_rate', 'approved_rate', 'verified_rate'])
  if (rate !== null) return `${formatPercent(rate)}`
  const approved = firstNumber(row, ['approved_count', 'verified_count', 'completed_count'])
  const target = firstNumber(row, ['target_count', 'total_count', 'mission_count'])
  if (approved !== null && target) return `${approved}/${target}`
  return '없음'
}

function promotionSub(row) {
  const approved = firstNumber(row, ['approved_count', 'verified_count', 'completed_count'])
  const target = firstNumber(row, ['target_count', 'total_count', 'mission_count'])
  if (approved !== null && target !== null) return `승인 ${approved} / 대상 ${target}`
  return '홍보 데이터 확인'
}

function formatPercent(value) {
  const number = Number(value)
  const percent = number <= 1 ? number * 100 : number
  return `${Math.round(percent)}%`
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function formatDate(value) {
  if (!value) return '날짜 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
}

function statusLabel(status) {
  const map = {
    active: '활동',
    inactive: '비활성',
    pending: '대기',
    accepted: '승인',
    rejected: '거절',
    present: '출석',
    absent: '결석',
    late: '지각',
    excused: '면제',
    submitted: '제출',
    pending_review: '검토 대기',
    approved: '승인',
    missed: '미제출',
  }
  return map[status] || status || '-'
}

function truncate(value, size = 40) {
  const text = String(value ?? '')
  return text.length > size ? `${text.slice(0, size)}…` : text
}
