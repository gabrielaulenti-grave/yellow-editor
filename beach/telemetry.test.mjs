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
