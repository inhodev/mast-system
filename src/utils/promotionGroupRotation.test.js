import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPicks, groupPrediction, nextGroupMember } from './promotionGroupRotation.js'
import { promotionMissItems, isPromotionTarget, promotionReminderTargets } from './promotionAssignmentPolicy.js'
const inha = { school_key: '테스트대학교', group_code: 'C', members: [{ id:'woo',name:'첫담당' },{ id:'kim',name:'다음담당' },{ id:'ma',name:'그다음담당' }], last_member_id:null }
const rotation = { next_round:0,next_group:'A',next_date:'2026-11-10',interval_days:3,schools:[inha,{school_key:'학교a',group_code:'A',members:[{id:'a'}]}] }
test('only the current group gets one member per school; a one-person school repeats',()=>{
 assert.deepEqual(groupPicks(rotation).map(row=>row.member.id),['a'])
 assert.equal(nextGroupMember({...inha,last_member_id:'woo'}).id,'kim')
 assert.equal(nextGroupMember({members:[{id:'only'}],last_member_id:'only'}).id,'only')
})
test('school group and individual rotation jointly produce the approved dates',()=>{
 const args={rotation,member:{id:'woo',school:'테스트대학교'},today:'2026-11-09'}
 assert.equal(groupPrediction(args).date,'2026-11-16')
 assert.equal(groupPrediction({...args,member:{id:'kim',school:'테스트대학교'}}).date,'2026-11-25')
 assert.deepEqual(groupPrediction({...args,assignments:[{member_id:'woo',mission_date:'2026-11-17',status:'pending'}]}),{date:'2026-11-17',confirmed:true,group:'C'})
 const after={...rotation,next_round:3,next_group:'A',next_date:'2026-11-19',schools:[{...inha,last_member_id:'woo'}]}
 assert.equal(groupPrediction({...args,rotation:after,member:{id:'kim',school:'테스트대학교'}}).date,'2026-11-25')
 assert.equal(groupPrediction({...args,member:{id:'unknown',school:'테스트대학교'}}),null)
})
test('resting members have no penalties or reminders, exemptions are excluded, historical misses stay',()=>{
 const assignments=[{id:'old',mission_id:'past',status:'missed'},{id:'current',mission_id:'round',status:'pending'},{id:'exempt',mission_id:'round',status:'exempted'}]
 const missions=new Map([['past',{title:'과거',due_at:'2026-10-01'}],['round',{title:'A조',due_at:'2026-11-11'}]])
 assert.equal(isPromotionTarget(null),false)
 assert.deepEqual(promotionMissItems([],missions,Date.parse('2026-11-12')),[])
 assert.deepEqual(promotionMissItems(assignments,missions,Date.parse('2026-11-10')).map(x=>x.id),['promo-old'])
 assert.deepEqual(promotionReminderTargets([...assignments,{status:'submitted'},{status:'late'},{status:'approved'}]).map(x=>x.id),['old','current'])
})


test('daily A/B/C cadence repeats each school every three days and retains confirmed assignments',()=>{
 const daily={...rotation,interval_days:1}
 const base={rotation:daily,member:{id:'woo',school:'테스트대학교'},today:'2026-11-09'}
 assert.equal(groupPrediction(base).date,'2026-11-12')
 assert.equal(groupPrediction({...base,member:{id:'kim',school:'테스트대학교'}}).date,'2026-11-15')
 const afterA={...daily,next_round:1,next_group:'B',next_date:'2026-11-11'}
 assert.equal(groupPrediction({...base,rotation:afterA}).date,'2026-11-12')
 assert.equal(groupPrediction({...base,rotation:afterA,assignments:[{member_id:'woo',mission_date:'2026-11-16',status:'pending'}]}).date,'2026-11-16')
})
