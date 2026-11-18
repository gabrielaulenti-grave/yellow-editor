import test from "node:test";
import assert from "node:assert/strict";
import { newTraining, migrateTraining, recordRound, fitness,
  milestoneBonus, backfillMilestones, recoverCurrentSpecialists, publicMilestones } from "./learner.mjs";

function round(score, tricks={}) {
  return { finished:true,score,progress:1,wipeouts:0,
    radness:0,hpRemaining:1000,averageSpeed:1.5,tricks };
}

test("rare trick bonus rewards breakthroughs but is capped per category",()=>{
  assert.equal(milestoneBonus(round(100)),0);
  assert.equal(milestoneBonus(round(100,{"150":1,"180":1,"350":1,"500":1})),565);
  assert.equal(milestoneBonus(round(100,{"350":99})),300);
  assert.ok(fitness(round(900,{"180":1}),0.9)>fitness(round(900),0.9));
  assert.ok(fitness(round(3000),0.9)>fitness(round(1000,{"500":1}),0.9));
  assert.ok(fitness(round(500),0.9)>fitness({
    finished:false,score:0,progress:1,wipeouts:0,tricks:{"350":1}},0.9));
});

test("first historic +350 discovery is credited without inventing saved weights",()=>{
  const t=newTraining();
  const archive=[{generation:20,runs:[{run:941,policy:8,score:2591,
      finished:true,tricks:{"350":1}}]},
    {generation:19,runs:[{run:901,policy:10,score:3113,
      finished:true,tricks:{"350":1}}]}];
  backfillMilestones(t,archive);
  assert.deepEqual(publicMilestones(t).find(row=>row.award===350).first,
    {generation:19,run:901,policy:10,score:3113,finished:true});
  assert.equal(t.hallOfFame["350"].specialist,undefined);
  backfillMilestones(t,archive);
  assert.equal(t.hallOfFame["350"].first.run,901);
});

test("a non-elite +350 discoverer survives across future generations",()=>{
  const t=newTraining();
  t.candidates[9].weights.fill(0.77);
  const specialist=[...t.candidates[9].weights];
  for(let i=0;i<48;i++) {
    const isTenth=i>=36 && i<40;
    recordRound(t,round(isTenth ? 100 : 4000,
      i===36 ? {"350":1} : {}));
  }
  assert.equal(t.generation,2);
  const hof=t.hallOfFame["350"];
  assert.equal(hof.first.run,37);
  assert.deepEqual(hof.specialist.weights,specialist);
  assert.deepEqual(t.candidates[3].weights,specialist);
  assert.equal(publicMilestones(t).find(x=>x.award===350).specialist.run,37);
  // Even 48 rounds with no milestone cannot evict the specialty.
  for(let i=0;i<48;i++) recordRound(t,round(4500));
  assert.equal(t.generation,3);
  assert.deepEqual(t.hallOfFame["350"].specialist.weights,specialist);
  assert.deepEqual(t.candidates[3].weights,specialist);
  assert.equal(migrateTraining(t).hallOfFame["350"].specialist.run,37);
});

test("historically recorded first discovery and newly recovered specialist stay distinct",()=>{
  const t=newTraining();
  backfillMilestones(t,[{generation:19,runs:[{
    run:901,policy:10,score:3113,finished:true,tricks:{"350":1}
  }]}]);
  recordRound(t,round(1200,{"350":1}));
  assert.equal(t.hallOfFame["350"].first.run,901);
  assert.equal(t.hallOfFame["350"].specialist.run,1);
  assert.equal(publicMilestones(t).find(x=>x.award===350).specialist.run,1);
});

test("milestone public telemetry never leaks full network weights",()=>{
  const t=newTraining();
  recordRound(t,round(1234,{"180":1}));
  const publicView=JSON.stringify(publicMilestones(t));
  assert.ok(publicView.includes('"award":180'));
  assert.ok(!publicView.includes('"weights"'));
  assert.ok(!publicView.includes('"champion"'));
});

test("recover exact current-generation +180 and +350 specialists after checkpoint migration",()=>{
  const t=newTraining();
  t.generation=21;
  t.candidates[3].weights.fill(.44);
  t.candidates[9].weights.fill(.99);
  t.generationRuns=[
    {run:975,policy:4,score:2239,finished:true,tricks:{"350":1}},
    {run:998,policy:10,score:1500,finished:true,tricks:{"180":1}},
  ];
  backfillMilestones(t,[{generation:19,runs:[{
    run:901,policy:10,score:3113,finished:true,tricks:{"350":1}
  }]}]);
  recoverCurrentSpecialists(t);
  assert.equal(t.hallOfFame["350"].first.run,901);
  assert.equal(t.hallOfFame["350"].specialist.run,975);
  assert.deepEqual(t.hallOfFame["350"].specialist.weights,t.candidates[3].weights);
  assert.equal(t.hallOfFame["180"].first.run,998);
  assert.deepEqual(t.hallOfFame["180"].specialist.weights,t.candidates[9].weights);
});
