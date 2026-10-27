import test from 'node:test'
import assert from 'node:assert/strict'
import { isPromotionTarget, promotionSubmissionError, promotionMissItems } from './promotionAssignmentPolicy.js'

test('exemptions are neither targets nor late penalties, while pending remains a target', () => {
  assert.equal(isPromotionTarget(null), false)
  assert.equal(isPromotionTarget({ status: 'exempted' }), false)
  assert.equal(isPromotionTarget({ status: 'pending' }), true)
  const assignments = ['pending', 'missed', 'rejected', 'exempted', 'submitted', 'approved', 'late'].map((status, id) => ({ id, mission_id: 1, status }))
  const missions = new Map([['1', { title: '홍보', due_at: '2026-10-26T00:00:00Z' }]])
  assert.deepEqual(promotionMissItems(assignments, missions, Date.parse('2026-10-27')).map(x => x.id), ['promo-0', 'promo-1', 'promo-2'])
  assert.deepEqual(promotionMissItems(assignments, missions, Date.parse('2026-10-25')), [])
})

test('exemption and deadline errors explain the actual reason instead of asking for retries', () => {
  assert.match(promotionSubmissionError(new Error('면제된 미션입니다.')), /면제/)
  assert.match(promotionSubmissionError(new Error('인증 제출 시간이 지났습니다.')), /시간/)
  assert.match(promotionSubmissionError(new Error('JWT expired')), /로그인/)
  assert.match(promotionSubmissionError(new Error('internal database error')), /저장하지 못/)
})
