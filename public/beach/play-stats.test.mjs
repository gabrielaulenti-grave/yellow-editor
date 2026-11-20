import test from "node:test";
import assert from "node:assert/strict";
import {PersonalTracker,inspectSymbols,parseSymbols,readBeachMemory,initialPersonalStats,trickValue} from "./play-stats.mjs";

test("rejects missing or non-WRAM collision instrumentation",()=>{
  assert.throws(()=>inspectSymbols({wSurfingMinigameRoutineNumber:0xc000}),/Missing/);
  const text="00:c000 wSurfingMinigameRoutineNumber\n00:d000 wBeachTrainerLastLandingQuality\n";
  assert.equal(parseSymbols(text).wBeachTrainerLastLandingQuality,0xd000);
});
test("BCD scores and directly recorded ROM landing byte are read without guessing",()=>{
  const map={routine:0xc000,state:0xc001,hp:0xc002,radness:0xc004,score:0xc006,
    landing:0xc008,meter:0xc009,flags:0xc00a};
  const memory=new Map([[0xc000,1],[0xc001,2],[0xc002,0x57],[0xc003,0x21],
    [0xc004,0x80],[0xc005,0x01],[0xc006,0x99],[0xc007,0x04],
    [0xc008,2],[0xc009,2],[0xc00a,3]]);
  const s=readBeachMemory(x=>memory.get(x)||0,map);
  assert.equal(s.hp,2157);
  assert.equal(s.radness,180);
  assert.equal(s.score,499);
  assert.equal(s.landing,2);
});
test("records two scored ROM-confirmed landings and finished result exactly once",()=>{
  const tracker=new PersonalTracker();
  const base={routine:1,state:0,score:0,hp:5000,radness:0,landing:0,meter:0,flags:0};
  const observe=changes=>tracker.read({...base,...changes});
  observe({});
  observe({state:1,meter:2,flags:3});
  observe({state:1,meter:2,flags:3});
  observe({state:2,radness:180,landing:1});
  observe({state:0,radness:180});
  observe({state:1,radness:180,meter:1,flags:1});
  observe({state:2,radness:230,landing:3});
  const result=observe({routine:10,state:6,score:4250,radness:230});
  assert.equal(result.status,"completed");
  assert.equal(result.score,4250);
  assert.equal(result.landings.clean,1);
  assert.equal(result.landings.hard,1);
  assert.equal(result.tricks[180],1);
  assert.equal(result.tricks[50],1);
  assert.equal(tracker.stats.total,1);
  assert.equal(tracker.stats.finished,1);
  assert.equal(tracker.stats.bestScore,4250);
  assert.equal(observe({routine:11,score:4250}),null);
  assert.equal(tracker.stats.total,1);
});
test("crashes, early failure and canceled play do not create false high scores",()=>{
  const t=new PersonalTracker(initialPersonalStats());
  const base={routine:1,state:1,score:0,hp:200,radness:180,landing:0,meter:2,flags:3};
  t.read(base);
  t.read({...base,state:3,landing:4});
  const bad=t.read({...base,routine:12,state:4,score:0});
  assert.equal(bad.status,"failed");
  assert.equal(bad.landings.wipeout,1);
  assert.equal(t.stats.bestScore,0);
  t.read({...base,state:1});
  t.read({...base,routine:0,state:4});
  assert.equal(t.stats.aborted,1);
  assert.equal(t.stats.total,2);
});
test("trick classification distinguishes mixed double and triple rotations",()=>{
  assert.equal(trickValue(2,3),180);
  assert.equal(trickValue(3,3),500);
  assert.equal(trickValue(3,1),350);
  assert.equal(trickValue(0,0),0);
});
