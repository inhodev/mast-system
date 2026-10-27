import { isPromotionTarget } from '../utils/promotionAssignmentPolicy.js'
import { requireSupabase, throwIfError, LEGACY_MEMBER_FIELDS } from './baseService'

const PROOF_BUCKET = 'proofs'
const SUBMITTED_STATUSES = ['submitted', 'approved', 'late']

export function todayKST() {
  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`
}

export function promotionStatusLabel(status) {
  if (status === 'approved') return '인증 완료'
  if (status === 'late') return '지각 완료'
  if (status === 'submitted') return '제출됨'
  if (status === 'exempted') return '면제'
  if (status === 'rejected') return '미완료'
  if (status === 'missed') return '미제출'
  return '미제출'
}

export function isPromotionSubmitted(status) {
  return SUBMITTED_STATUSES.includes(status)
}

export async function getPromotionDashboard(currentMember) {
  const client = requireSupabase()
  const promotionMember = await findPromotionMember(currentMember)
  const mission = await fetchVisibleMemberMission(client, todayKST())

  if (!promotionMember) {
    return {
      promotionMember: null,
      mission,
      assignment: null,
      proof: null,
      records: [],
      assignees: [],
    }
  }

  let assignment = null
  let proof = null
  let assignees = []

  if (mission) {
    const assignmentResult = await client
      .from('promotion_mission_assignments')
      .select('*')
      .eq('member_id', promotionMember.id)
      .eq('mission_id', mission.id)
      .maybeSingle()
    throwIfError(assignmentResult.error)
    assignment = assignmentResult.data || null

    if (assignment) {
      const proofResult = await client
        .from('promotion_proofs')
        .select('*')
        .eq('assignment_id', assignment.id)
        .maybeSingle()
      throwIfError(proofResult.error)
      proof = proofResult.data || null
    }

    const assigneeResult = await client
      .from('promotion_assignment_status_view')
      .select('member_id,member_name,gi,school,status,submitted_at')
      .eq('mission_id', mission.id)
    if (!assigneeResult.error) assignees = (assigneeResult.data || []).filter(isPromotionTarget)
  }

  const recordsResult = await client
    .from('promotion_assignment_status_view')
    .select('*')
    .eq('member_id', promotionMember.id)
    .order('mission_date', { ascending: false })
    .limit(8)
  const records = recordsResult.error ? [] : recordsResult.data || []

  return { promotionMember, mission, assignment, proof, records, assignees }
}

export async function submitPromotionProof({ assignment, mission, member, file, existingProof }) {
  if (!assignment?.id) throw new Error('홍보 배정 정보를 찾지 못했습니다.')
  if (!mission?.id) throw new Error('홍보 미션 정보를 찾지 못했습니다.')
  if (!file && !existingProof) throw new Error('인증 이미지를 선택해 주세요.')

  const client = requireSupabase()
  const nowIso = new Date().toISOString()
  const row = {
    assignment_id: assignment.id,
    mission_id: mission.id,
    member_id: member.id,
    submitted_at: nowIso,
  }

  if (file) {
    if (!/^image\//.test(file.type)) throw new Error('이미지 파일만 업로드할 수 있습니다.')
    if (existingProof?.proof_file_path) {
      await client.storage.from(PROOF_BUCKET).remove([existingProof.proof_file_path])
    }
    const ext = String(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const safeName = encodeURIComponent(`${member.name}-${member.gi || member.generation || ''}`).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)
    const path = `${mission.mission_date || todayKST()}/${safeName}_${Date.now()}.${ext}`
    const upload = await client.storage.from(PROOF_BUCKET).upload(path, file, { upsert: true })
    throwIfError(upload.error)
    row.proof_file_path = path
    row.proof_image_url = client.storage.from(PROOF_BUCKET).getPublicUrl(path).data.publicUrl
  }

  const proofResult = existingProof
    ? await client.from('promotion_proofs').update(row).eq('id', existingProof.id)
    : await client.from('promotion_proofs').upsert(row, { onConflict: 'assignment_id' })
  throwIfError(proofResult.error)

  const assignmentResult = await client
    .from('promotion_mission_assignments')
    .update({ status: 'submitted', submitted_at: nowIso, status_reason: null })
    .eq('id', assignment.id)
  throwIfError(assignmentResult.error)
}

export async function findPromotionMember(currentMember) {
  if (!currentMember?.id) return null
  const client = requireSupabase()
  let legacyId = currentMember.mast_member_id
  if (!legacyId) {
    const { data, error } = await client.rpc('mast_current_legacy_id')
    throwIfError(error)
    legacyId = data
  }
  if (!legacyId) return null
  const { data, error } = await client.from('members')
    .select(LEGACY_MEMBER_FIELDS)
    .eq('id', legacyId)
    .eq('status', 'active')
    .maybeSingle()
  throwIfError(error)
  return data ?? null
}

async function fetchVisibleMemberMission(client, today) {
  const nowIso = new Date().toISOString()
  const open = await client
    .from('promotion_missions')
    .select('*')
    .eq('status', 'active')
    .lte('mission_date', today)
    .gte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (open.data) return open.data
  const fallback = await client
    .from('promotion_missions')
    .select('*')
    .eq('mission_date', today)
    .maybeSingle()
  throwIfError(fallback.error)
  return fallback.data || null
}
