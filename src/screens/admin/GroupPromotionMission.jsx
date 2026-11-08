import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { addRotationDays, groupPicks, nextGroupMember } from '../../utils/promotionGroupRotation.js'

const fieldStyle = { width: '100%', padding: '11px 12px', border: '1px solid #ccd7e7', borderRadius: 9, font: 'inherit' }
const cardStyle = { background: '#fff', border: '1px solid #e0e7ef', borderRadius: 14, padding: 20, marginBottom: 16 }

export default function GroupPromotionMission({ session }) {
  const [rotation, setRotation] = useState(null)
  const [day, setDay] = useState('')
  const [mission, setMission] = useState(null)
  const [form, setForm] = useState({ title: '', body: '', post_title: '', post_body: '', mission_image_url: null, mission_image_path: null })
  const [dueDay, setDueDay] = useState('')
  const [dueTime, setDueTime] = useState('02:00')
  const [assigned, setAssigned] = useState([])
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true); setError('')
    try {
      const context = await supabase.rpc('mast_promotion_rotation')
      if (version !== requestVersion.current) return
      if (context.error) throw context.error
      const r = context.data
      setRotation(r)
      const targetDay = day || r.next_date
      if (!day) { setDay(targetDay); return }
      const existing = await supabase.from('promotion_missions').select('*').eq('mission_date', targetDay).maybeSingle()
      if (version !== requestVersion.current) return
      if (existing.error) throw existing.error
      if (existing.data) {
        const m = existing.data
        if (m.rotation_round == null) throw new Error('기존 미션은 과거 기록 탭에서 확인해 주세요. 기존 배정과 인증은 유지됩니다.')
        const rows = await supabase.from('promotion_assignment_status_view').select('*').eq('mission_id', m.id)
        if (version !== requestVersion.current) return
        if (rows.error) throw rows.error
        setMission(m); setForm(m); setAssigned(rows.data || [])
        setDueDay(new Date(m.due_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDueTime(new Date(m.due_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }))
      } else {
        const latest = await supabase.from('promotion_missions').select('*').order('mission_date', { ascending: false }).limit(1).maybeSingle()
        if (version !== requestVersion.current) return
        if (latest.error) throw latest.error
        const m = latest.data || {}
        setMission(null); setAssigned([])
        setForm({ title: `MAST 홍보 · ${r.next_group}조 · ${targetDay}`, body: m.body || '', post_title: m.post_title || m.title || '', post_body: m.post_body || '', mission_image_url: m.mission_image_url || null, mission_image_path: m.mission_image_path || null })
        setDueDay(addRotationDays(targetDay, 1)); setDueTime('02:00')
      }
      setFile(null)
    } catch (e) { if (version === requestVersion.current) setError(e.message || '조별 배정을 불러오지 못했습니다.') }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [day])
  useEffect(() => { load() }, [load])

  const group = mission?.rotation_group || rotation?.next_group
  const schools = (rotation?.schools || []).filter(row => row.group_code === group)
  const recommendations = groupPicks(rotation)
  const rows = mission ? assigned.filter(row => row.status !== 'exempted').map(row => ({ school: row.school, name: row.member_name, gi: row.gi, id: row.member_id }))
    : recommendations.map(({ school, member }) => ({ school: school.school_name, name: member?.name, gi: member?.gi, id: member?.id }))
  const missingSchool = !mission && recommendations.some(row => !row.member)
  const update = (name, value) => setForm(prev => ({ ...prev, [name]: value }))

  async function save(event) {
    event.preventDefault()
    if (busy || loading || !rotation || missingSchool) return
    setBusy(true); setError(''); setMessage('')
    try {
      const due = new Date(`${dueDay}T${dueTime}:00+09:00`).toISOString()
      if (dueDay < day) throw new Error('마감일은 홍보일 이후로 설정해 주세요.')
      const row = { ...form, mission_date: day, due_at: due, created_by: session.member.name }
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('10MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.')
        const path = `${day}_${crypto.randomUUID()}.${file.type.split('/')[1]}`
        const upload = await supabase.storage.from('missions').upload(path, file)
        if (upload.error) throw upload.error
        row.mission_image_path = path
        row.mission_image_url = supabase.storage.from('missions').getPublicUrl(path).data.publicUrl
      }
      const result = await supabase.rpc('mast_save_promotion_round', { p_mission: row, p_expected_round: rotation.next_round, p_expected_member_ids: rows.map(row => row.id) })
      if (result.error) throw result.error
      setMessage(mission ? '미션 내용을 수정했습니다. 담당자와 기존 인증 기록은 유지됩니다.' : `${group}조 ${rows.length}명 배정을 확정했습니다. 다른 회원에게는 제출 의무와 감점이 없습니다.`)
      await load()
    } catch (e) { setError(e.message || '미션을 확정하지 못했습니다. 다시 확인해 주세요.') }
    finally { setBusy(false) }
  }

  return <section style={{ maxWidth: 1100, margin: 'auto' }}>
    <h1 style={{ color: '#13264a', fontSize: 26 }}>조별 홍보 미션</h1>
    <p>3일마다 A → B → C조 순환 · 학교별 1명 · 같은 학교는 9일마다 다음 담당자</p>
    {error && <p role="alert" style={{ color: '#b42318', whiteSpace: 'pre-wrap' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#176b4a' }}>{message}</p>}
    <div style={cardStyle}>
      <label>홍보일 <input aria-label="홍보일" style={{ ...fieldStyle, width: 180, margin: '0 12px' }} type="date" value={day} min={rotation?.start_date} onChange={e => { setMessage(''); setDay(e.target.value) }} /></label>
      {!!rotation?.rounds?.length && <label style={{ display: 'inline-block', marginBottom: 12 }}>확정 미션 <select aria-label="확정 미션 선택" style={{ ...fieldStyle, width: 230, margin: '0 12px' }} value={mission ? day : ''} onChange={e => { setMessage(''); setDay(e.target.value || rotation.next_date) }}><option value="">다음 미션 · {rotation.next_group}조</option>{rotation.rounds.map(r => <option key={r.id} value={r.mission_date}>{r.mission_date} · {r.rotation_group}조 · {r.rotation_round + 1}회차</option>)}</select></label>}
      {mission && <button type="button" onClick={() => { setMessage(''); setDay(rotation.next_date) }}>다음 미션 만들기 · {rotation?.next_group}조</button>}
      <p><b>{group || '불러오는 중'}조 · {mission ? `${mission.rotation_round + 1}회차 확정` : `${(rotation?.next_round ?? 0) + 1}회차 예정`}</b> / {schools.length}개 학교 · 담당 {rows.length}명</p>
      <p style={{ fontSize: 13, color: '#64748b' }}>다른 조와 학교 안 비담당자는 배정하지 않습니다. 확정한 미션을 다시 저장해도 다음 조로 넘어가지 않습니다.</p>
      <button type="button" onClick={() => setShowGroups(v => !v)}>{showGroups ? '전체 조 편성 접기' : '전체 조 편성 보기'}</button>
      {showGroups && <div style={{ overflowX: 'auto', marginTop: 14 }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}><thead><tr><th>조</th><th>학교</th><th>소속 인원</th><th>다음 학교 담당자</th></tr></thead><tbody>{(rotation?.schools || []).map(s => <tr key={s.school_key}><td>{s.group_code}조</td><td>{s.school_name}</td><td>{s.members.length}명</td><td>{nextGroupMember(s)?.name || '활동 회원 없음'}</td></tr>)}</tbody></table></div>}
    </div>
    {loading ? <p>배정 정보를 불러오는 중...</p> : <form onSubmit={save}>
      <div style={cardStyle}><h2 style={{ fontSize: 18 }}>{group}조 담당자 {mission ? '(확정 명단)' : '(자동 추천)'}</h2>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 370 }}><thead><tr><th style={{ textAlign: 'left' }}>학교</th><th style={{ textAlign: 'left' }}>담당자</th><th style={{ textAlign: 'left' }}>기수</th></tr></thead><tbody>{rows.map(row => <tr key={row.id || row.school}><td style={{ padding: '9px 0', borderTop: '1px solid #e5eaf0' }}>{row.school}</td><td><b>{row.name || '활동 회원 없음'}</b></td><td>{row.gi}</td></tr>)}</tbody></table></div>
      </div>
      <div style={cardStyle}>
        {[['title', '미션명'], ['post_title', '에타 게시글 제목']].map(([key, label]) => <label key={key} style={{ display: 'block', marginBottom: 16 }}>{label}<input style={fieldStyle} required value={form[key] || ''} onChange={e => update(key, e.target.value)} /></label>)}
        {[['post_body', '에타 게시글 내용'], ['body', '미션 안내']].map(([key, label]) => <label key={key} style={{ display: 'block', marginBottom: 16 }}>{label}<textarea style={{ ...fieldStyle, minHeight: 170 }} value={form[key] || ''} onChange={e => update(key, e.target.value)} /></label>)}
        <label>마감일<input aria-label="마감일" style={{ ...fieldStyle, width: 180, margin: '0 12px 12px' }} required type="date" min={day} value={dueDay} onChange={e => setDueDay(e.target.value)} /></label>
        <label>마감 시간<input aria-label="마감 시간" style={{ ...fieldStyle, width: 130, margin: '0 12px 12px' }} required type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
        <p style={{ fontSize: 13, color: '#64748b' }}>지각 제출 가능 시간은 마감 후 24시간입니다. 기존 인증 상태는 수정하지 않습니다.</p>
        {form.mission_image_url && <img src={form.mission_image_url} alt="현재 홍보 포스터" style={{ display: 'block', maxWidth: 220, maxHeight: 300, objectFit: 'contain', margin: '12px 0' }} />}
        <label>포스터 변경 <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
      </div>
      <button type="submit" disabled={busy || loading || !rotation || !rows.length || missingSchool} style={{ ...fieldStyle, background: '#2459e0', color: 'white', fontWeight: 800, cursor: 'pointer', opacity: busy || !rows.length ? 0.6 : 1 }}>{busy ? '저장 중...' : mission ? '내용 수정 · 기존 배정과 인증 유지' : `${group}조 미션 확정 · ${rows.length}명 배정`}</button>
    </form>}
  </section>
}
