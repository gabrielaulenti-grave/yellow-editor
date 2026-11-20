// Pure per-session scoring tracker for the privately loaded browser ROM.
// Reads only RAM, never imports or transmits the cartridge bytes.
const BCD = bytes => {
  if (!bytes || bytes.some(n=>!Number.isInteger(n)||n<0||n>255||((n&15)>9)||((n>>4)>9))) return null;
  return bytes.reduceRight((score,n)=>score*100+((n>>4)*10+(n&15)),0);
};
export const FIELD_NAMES=Object.freeze({
  routine:"wSurfingMinigameRoutineNumber",
  state:"wSurfingMinigamePikachuState",
  hp:"wSurfingMinigamePikachuHP",
  radness:"wSurfingMinigameRadnessScore",
  score:"wSurfingMinigameTotalScore",
  landing:"wBeachTrainerLastLandingQuality",
  meter:"wSurfingMinigameRadnessMeter",
  flags:"wSurfingMinigameTrickFlags",
});
export function parseSymbols(text) {
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*([0-9a-fA-F]+):([0-9a-fA-F]{4})\s+([A-Za-z0-9_.$@]+)/.exec(line);
    if(m) result[m[3]]=parseInt(m[2],16);
  }
  return result;
}
export function inspectSymbols(symbols) {
  const addresses={};
  for(const [key,name] of Object.entries(FIELD_NAMES)) {
    const addr=symbols[name];
    if(!Number.isInteger(addr)||addr<0xc000||addr>=0xe000)
      throw new Error("Missing or invalid WRAM symbol: "+name+". Use the matching patched disassembly's .sym.");
    addresses[key]=addr;
  }
  return addresses;
}
export function readBeachMemory(read, a) {
  return {
    routine:read(a.routine),state:read(a.state),landing:read(a.landing),
    score:BCD([read(a.score),read(a.score+1)]),
    hp:BCD([read(a.hp),read(a.hp+1)]),
    radness:BCD([read(a.radness),read(a.radness+1)]),
    meter:read(a.meter),flags:read(a.flags),
  };
}
export function initialPersonalStats() {
  return {schema:1,total:0,finished:0,aborted:0,failed:0,bestScore:0,
    scoreSum:0,landings:{clean:0,rough:0,hard:0,wipeout:0,unknown:0},
    tricks:{"50":0,"150":0,"180":0,"350":0,"500":0},
    history:[]};
}
export function trickValue(meter,flags) {
  if(!Number.isInteger(meter)||meter<1)return 0;
  if((flags&3)===3)return meter>=3?500:180;
  return meter>=3?350:meter===2?150:50;
}
const sampleCount=1000;
export class PersonalTracker {
  constructor(saved=initialPersonalStats()) {
    this.stats={...initialPersonalStats(),...saved,
      landings:{...initialPersonalStats().landings,...saved.landings},
      tricks:{...initialPersonalStats().tricks,...saved.tricks},
      history:Array.isArray(saved.history)?saved.history.slice(-sampleCount):[]};
    this.current=null;
    this.previous=null;
  }
  read(sample) {
    if(!sample || !Number.isInteger(sample.routine))return null;
    const prev=this.previous;
    if(sample.routine===1&&!this.current) {
      this.current={at:new Date().toISOString(),score:0,radness:0,
        landings:{clean:0,rough:0,hard:0,wipeout:0,unknown:0},
        tricks:{"50":0,"150":0,"180":0,"350":0,"500":0},
        lastMeter:0,lastFlags:0};
    }
    const run=this.current;
    if(run) {
      if(sample.routine===1) {
        if(Number.isInteger(sample.radness))run.radness=Math.max(run.radness,sample.radness);
        if(prev?.state===1 && (sample.state===2||sample.state===3)) {
          const outcome={1:"clean",2:"rough",3:"hard",4:"wipeout"}[sample.landing]||"unknown";
          run.landings[outcome]++;
          if(sample.state===2) {
            const award=trickValue(run.lastMeter,run.lastFlags);
            if(award)run.tricks[String(award)]++;
          }
        }
        run.lastMeter=sample.meter;
        run.lastFlags=sample.flags;
      }
      if((sample.routine===10||sample.routine===11||sample.routine===12)&&
         Number.isInteger(sample.routine)) {
        return this.finalize(sample.routine===12?"failed":"completed",
          sample.routine===12?0:sample.score||0);
      }
      // Select may cancel the minigame without a game-over screen.
      if(prev?.routine===1 && sample.routine===0)return this.finalize("aborted",0);
    }
    this.previous=sample;
    return null;
  }
  finalize(status,score) {
    const run=this.current;
    if(!run)return null;
    const result={at:run.at,status,score,radness:run.radness,
      landings:run.landings,tricks:run.tricks};
    const stats=this.stats;
    stats.total++;
    if(status==="completed") {
      stats.finished++;
      stats.bestScore=Math.max(stats.bestScore,score);
      stats.scoreSum+=score;
    }else if(status==="failed")stats.failed++;
    else stats.aborted++;
    for(const key of Object.keys(stats.landings))stats.landings[key]+=run.landings[key]||0;
    for(const key of Object.keys(stats.tricks))stats.tricks[key]+=run.tricks[key]||0;
    stats.history.push(result);
    if(stats.history.length>sampleCount)stats.history.splice(0,stats.history.length-sampleCount);
    this.current=null;
    this.previous=null;
    return result;
  }
}
