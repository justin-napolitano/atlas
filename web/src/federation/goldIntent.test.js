import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGoldProposal } from './goldIntent.js';

test('101 gold recipients allocate no frozen intent and correction remains possible', () => {
  const audience = Array.from({length:101}, (_,i)=>`synthetic-person-${i}`);
  let pending=null, allocations=0;
  const allocate=people=>{allocations++;return {manifest_id:'synthetic-immutable-id',audience_user_ids:people};};
  assert.throws(()=>{pending=prepareGoldProposal(audience,allocate);},/between 1 and 100/);
  assert.equal(pending,null);assert.equal(allocations,0);
  pending=prepareGoldProposal(audience.slice(0,100),allocate);
  assert.equal(allocations,1);assert.equal(pending.audience_user_ids.length,100);
});
test('gold audience deduplicates before its bound and does not mutate selection',()=>{
  const audience=['synthetic-alice','synthetic-bob','synthetic-alice'];
  assert.deepEqual(prepareGoldProposal(audience,people=>people),['synthetic-alice','synthetic-bob']);
  assert.equal(audience.length,3);assert.throws(()=>prepareGoldProposal([],()=>{}));
});
