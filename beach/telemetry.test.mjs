import test from "node:test";
import assert from "node:assert/strict";
import { startRunTelemetry, observeRun, finishRunTelemetry, trickAward, generationSummary } from "./telemetry.mjs";
import { newTraining, migrateTraining, recordRound } from "./learner.mjs";

test("classifies exact original-game trick awards, including mixed +500", () => {
  assert.equal(trickAward(0,0), 0);
  assert.equal(trickAward(1,1), 50);
  assert.equal(trickAward(2,2), 150);
  assert.equal(trickAward(3,1), 350);
  assert.equal(trickAward(2,3), 180);
  assert.equal(trickAward(3,3), 500);
});
test("only a jump-to-landing transition records a successfully awarded trick", () => {
  const t = startRunTelemetry();
  const step = (state, radness, meter=0, flags=0) =>
    observeRun(t, { routine:1,state,trickMeter:meter,trickFlags:flags,speed:1.5,hp:5800,radness });
  step(0,0); step(1,0,2,3); step(1,0,2,3);
  step(2,180); step(2,180); step(3,180);
  step(0,180); step(1,180,3,1); step(2,530);
  const row = finishRunTelemetry(t,{finished:true,score:2000,progress:1,wipeouts:1});
  assert.equal(row.tricks[180],1);
  assert.equal(row.tricks[350],1);
  assert.equal(row.tricks[50],0);
  assert.equal(row.radness,530);
  assert.equal(row.unclassifiedRadness,0);
  assert.equal(row.hpRemaining,5800);
  assert.equal(row.averageSpeed,1.5);
});
test("generation summaries match runs, preserving partial imported generations", () => {
  const runs=[{finished:true,score:1200,radness:200,hpRemaining:5000,averageSpeed:1.5,tricks:{"50":1,"150":1}},
    {finished:false,score:0,radness:0,hpRemaining:0,averageSpeed:1.25,tricks:{"500":1}}];
  const s=generationSummary(7,runs);
  assert.equal(s.runs,2);
  assert.equal(s.complete,false);
  assert.equal(s.completionRate,0.5);
  assert.equal(s.averageScore,600);
  assert.equal(s.averageSpeed,1.375);
  assert.equal(s.tricks[50],1);
  assert.equal(s.tricks[500],1);
});
test("v4 checkpoint upgrades telemetry collections without erasing history", () => {
  const t=newTraining();
  delete t.generationRuns;delete t.pendingGenerations;
  t.total=123;t.generation=4;t.highScore=4568;
  migrateTraining(t);
  assert.deepEqual(t.generationRuns,[]);
  assert.deepEqual(t.pendingGenerations,[]);
  assert.equal(t.highScore,4568);
});
test("forty candidates and eight evaluation rounds archive exactly one generation", () => {
  const t=newTraining();
  for(let n=0;n<48;n++) {
    recordRound(t,{finished:true,score:100+n,progress:1,wipeouts:0,
      radness:n,hpRemaining:5000,averageSpeed:1.5,tricks:{"50":1}});
  }
  assert.equal(t.generation,2);
  assert.equal(t.pendingGenerations.length,1);
  assert.equal(t.pendingGenerations[0].runs.length,48);
  assert.equal(t.pendingGenerations[0].summary.complete,true);
  assert.equal(t.pendingGenerations[0].summary.tricks[50],48);
  assert.equal(t.generationRuns.length,0);
});

test("an unidentified positive radness increment is preserved, never misclassified", () => {
  const t=startRunTelemetry();
  observeRun(t,{routine:1,state:1,radness:0,speed:1,hp:5000});
  observeRun(t,{routine:1,state:2,radness:100,speed:1,hp:5000});
  const row=finishRunTelemetry(t,{finished:true,score:100,progress:1,wipeouts:0});
  assert.equal(row.tricks[50],0);
  assert.equal(row.unclassifiedRadness,100);
});

test("a real +500 landing is flagged for independent video archival", () => {
  const t = startRunTelemetry();
  const sample = (state,radness,meter=0,flags=0) =>
    observeRun(t,{routine:1,state,radness,trickMeter:meter,trickFlags:flags,hp:2000,speed:1.5});
  assert.equal(sample(0,0),false);
  assert.equal(sample(1,0,3,3),false);
  assert.equal(sample(2,500),true);
  assert.equal(sample(2,500),false);
  assert.equal(sample(0,500),false);
  assert.equal(sample(1,500,3,3),false);
  assert.equal(sample(2,1000),true);
  const result = finishRunTelemetry(t,{
    finished:false,score:0,progress:0.78,wipeouts:1
  });
  assert.equal(result.confirmed500,2);
  assert.equal(result.tricks["500"],2);
  assert.equal(result.finished,false);
});
test("a +500 score increase without a successful landing is NOT preservation evidence", () => {
  const t = startRunTelemetry();
  observeRun(t,{routine:1,state:0,radness:0,speed:1,hp:500});
  assert.equal(observeRun(t,{routine:1,state:1,radness:500,speed:1,hp:500}),false);
  assert.equal(observeRun(t,{routine:1,state:3,radness:1000,speed:1,hp:500}),false);
  assert.equal(finishRunTelemetry(t,{finished:false,score:0,progress:.1,wipeouts:1}).confirmed500,0);
});

test("uncapped tricks continue beyond 9999 while the ROM BCD radness is saturated", () => {
  const telemetry=startRunTelemetry();
  const base={routine:1,hp:1400,speed:1.5};
  observeRun(telemetry,{...base,state:0,radness:0,trickMeter:0,trickFlags:0});
  for(let n=1;n<=22;n++) {
    const oldCapped=Math.min(9999,(n-1)*500);
    const newCapped=Math.min(9999,n*500);
    observeRun(telemetry,{...base,state:1,radness:oldCapped,trickMeter:3,trickFlags:3});
    assert.equal(observeRun(telemetry,{...base,state:2,radness:newCapped,trickMeter:3,trickFlags:3}),true);
  }
  const row=finishRunTelemetry(telemetry,{finished:true,score:9999,progress:1,wipeouts:0});
  assert.equal(row.tricks["500"],22);
  assert.equal(row.uncappedRadness,11000);
  assert.equal(row.extendedScore,12400);
  assert.equal(row.radness,9999);
  assert.equal(row.extendedValid,true);
  assert.equal(row.confirmed500,22);
});

test("missing observed landing points are flagged rather than allowed to inflate records",()=>{
  const t=startRunTelemetry();
  observeRun(t,{routine:1,state:1,radness:0,trickMeter:3,trickFlags:1,hp:1000,speed:1.5});
  observeRun(t,{routine:1,state:2,radness:100,trickMeter:3,trickFlags:1,hp:1000,speed:1.5});
  const row=finishRunTelemetry(t,{finished:true,score:1100,progress:1,wipeouts:0});
  assert.equal(row.tricks["350"],1);
  assert.equal(row.extendedValid,false);
  assert.equal(row.extendedScore,null);
});

test("uncompleted runs retain earned uncapped radness but never get an extended record score",()=>{
  const t=startRunTelemetry();
  observeRun(t,{routine:1,state:1,radness:0,trickMeter:2,trickFlags:3,hp:10,speed:1});
  observeRun(t,{routine:1,state:2,radness:180,trickMeter:2,trickFlags:3,hp:10,speed:1});
  const row=finishRunTelemetry(t,{finished:false,score:0,progress:.85,wipeouts:8});
  assert.equal(row.uncappedRadness,180);
  assert.equal(row.extendedScore,null);
});
