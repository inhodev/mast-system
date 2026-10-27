import test from 'node:test'
import assert from 'node:assert/strict'
import { nextPromotionDate } from './promotionSchoolRules.js'
test('personal prediction works without a mission, uses rotation and never predicts an unassigned today', () => {
  const members = [{ id: 'a', name: '가', school: '인하대학교' }, { id: 'b', name: '나', school: '인하대학교' }]
  const args = { members, assignments: [{ member_id: 'a', school: '인하대학교', mission_date: '2026-10-26', status: 'approved' }], today: '2026-10-27' }
  assert.equal(nextPromotionDate({ ...args, member: members[1] }), '2026-10-29')
  assert.equal(nextPromotionDate({ ...args, member: members[0] }), '2026-11-01')
  assert.equal(nextPromotionDate({ ...args, today: '2026-11-03', member: members[1] }), '2026-11-04')
  assert.equal(nextPromotionDate({ ...args, assignments: [], member: members[0] }), '2026-10-28')
  assert.equal(nextPromotionDate({ ...args, members: [], member: members[0] }), null)
})
test('prediction shares Mirae spellings and fourteen-day history, ignores exemptions and respects today assignment', () => {
  const members = [{ id: 'a', name: '가', school: '연세대학교(미래)' }, { id: 'b', name: '나', school: '연세대학교 미래캠퍼스' }]
  const assignments = [{ member_id: 'a', school: '연세대학교 미래', mission_date: '2026-10-23', status: 'approved' }, { member_id: 'b', school: members[1].school, mission_date: '2026-10-26', status: 'exempted' }]
  assert.equal(nextPromotionDate({ member: members[1], members, assignments, today: '2026-10-27' }), '2026-11-06')
  assignments.push({ member_id: 'b', school: members[1].school, mission_date: '2026-10-27', status: 'pending' })
  assert.equal(nextPromotionDate({ member: members[1], members, assignments, today: '2026-10-27' }), '2026-10-27')
  assert.equal(nextPromotionDate({ member: members[0], members, assignments, today: '2026-10-27' }), '2026-11-10')
})
import { promotionIntervalDays, promotionCopyForSchool, promotionSchoolKey, schoolRotationHistory, isSchoolRotationDue, allowsExistingPostProof, HUFS_REQUIRED_COPY } from './promotionSchoolRules.js'
test('only Mirae members may certify an existing post instead of publishing a new one', () => {
  for (const school of ['연세대학교(미래)', '연세대학교 미래캠퍼스', '연세대 미래캠']) assert.equal(allowsExistingPostProof(school), true)
  for (const school of ['연세대학교', '인하대학교', '한국외국어대학교', '', null]) assert.equal(allowsExistingPostProof(school), false)
})
test('Mirae spelling variants share one rotation history without merging Seoul', () => {
  const variants = ['연세대학교(미래)', '연세대학교(미래캠퍼스)', '연세대학교 미래', '연세대 미래캠']
  assert.equal(new Set(variants.map(promotionSchoolKey)).size, 1)
  assert.notEqual(promotionSchoolKey(variants[0]), promotionSchoolKey('연세대학교'))
  const rows = [{ school: variants[2], mission_date: '2026-10-23', status: 'approved' }, { school: variants[0], mission_date: '2026-10-26', status: 'exempted' }]
  assert.deepEqual(schoolRotationHistory(rows, variants[1]), [rows[0]])
  assert.equal(isSchoolRotationDue(variants[0], rows, '2026-10-26'), false)
  assert.equal(isSchoolRotationDue(variants[1], rows, '2026-11-05'), false)
  assert.equal(isSchoolRotationDue(variants[2], rows, '2026-11-06'), true)
  assert.equal(promotionIntervalDays(variants[3]), 14)
})
test('Mirae campus waits fourteen days; other schools keep three', () => {
  for (const school of ['연세대학교 미래캠퍼스', '연세대학교(미래)', '연세대학교 미래']) assert.equal(promotionIntervalDays(school), 14)
  for (const school of ['연세대학교', '한국외국어대학교', '한국외국어대학교(글로벌)', '인하대학교']) assert.equal(promotionIntervalDays(school), 3)
})
test('HUFS copy appends mandatory notice once and leaves other schools unchanged', () => {
  for (const school of ['한국외국어대학교', '한국외국어대학교(글로벌)']) {
    const copy = promotionCopyForSchool('홍보 본문', school)
    assert.equal(copy, '홍보 본문\n\n' + HUFS_REQUIRED_COPY)
    assert.equal(promotionCopyForSchool(copy, school), copy)
  }
  assert.equal(promotionCopyForSchool('홍보 본문', '연세대학교 미래캠퍼스'), '홍보 본문')
})
