import test from 'node:test'
import assert from 'node:assert/strict'
import { promotionIntervalDays, promotionCopyForSchool, promotionSchoolKey, schoolRotationHistory, isSchoolRotationDue, HUFS_REQUIRED_COPY } from './promotionSchoolRules.js'
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
