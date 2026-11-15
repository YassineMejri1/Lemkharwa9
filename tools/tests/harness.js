/* Astro Outpost — test harness for the mission rules (no browser needed).
   Loads the rule files (data, saved NASA flares, space weather, sim, crisis) into Node and gives the tests:
     JA, sim, R   the game's own objects
     arch         the saved May 2024 flare records, so every run sees the same Sun
     run(site, level, seed, opts)   a simple robot player that plays a whole mission through the rules
   Run the tests from the game folder:   node tools/tests/rules.test.js   and   node tools/tests/systems.test.js */
var P=require('path').join(__dirname,'..','..','js')+'/';
global.window={};
['data','archive-data','spaceweather','sim','crisis'].forEach(f=>require(P+f+'.js'));
var JA=window.JA, sim=JA.sim, R=JA.RULES;
module.exports={JA,sim,R};
// the archive exactly as the game loads it (flares, particle events, CMEs, CME arrivals, notes)
var arch=JA.weather.load('archive') && Object.assign({source:'archive'},window.JA_ARCHIVE_FLARES);
module.exports.arch=arch;
// bot: one action every `gap` seconds. opts.bags = target bags, opts.shelter = go inside on warning
function run(site,level,seed,o){
  o=o||{}; var gap=o.gap||10, D=o.D||300;
  var s=sim.newGame({site:site,level:level,seed:seed,weather:arch,dayLength:D,pioneer:!!o.pioneer});
  var hand=0, bagsReady=0, coresHeld=[], crates=0, log=[];
  while(!s.over){
    var next=0, fail=null;
    while(!s.dayDone && !fail){
      var ph=sim.stormPhase(s);
      var hiding = o.shelter!==false && (ph==='warning'||ph==='active');
      // opts.travel: seconds a real player needs to walk home after the warning (0 = the bot is always at the door)
      if(hiding && o.travel && s.storm && s.t < s.storm.start - sim.warnLead(s) + o.travel) hiding=false;
      var outside = !hiding;
      var ev=sim.tick(s,0.25,{outside:outside,driving:false});
      ev.forEach(function(e){ if(e.type==='fail')fail=e.reason; if(e.type==='bag')bagsReady++;
        if(e.type==='crisis'){ var v=JA.crisis.view(s); var pick=(o.pick&&o.pick[v.id])||v.options[0].id; var r=JA.crisis.choose(s,pick); if(r.skip){var secs=r.skip*s.dayLength; while(secs>0&&!s.dayDone){sim.tick(s,0.5,{outside:false});secs-=0.5;}} }
        if(e.type==='break'){ s._fixAt=s.t+25; } });
      if(s.glitch&&s.glitch.state==='broken'&&s.t>=s._fixAt) sim.repairDone(s);
      if(!outside||s.t<next) continue;
      next=s.t+gap;
      var m=s.m, beds=m.food.beds, i, did=false;
      // harvest/store
      for(i=0;i<4&&!did;i++) if(beds[i].state==='ripe'){ var kind=sim.harvest(s,i); if(!sim.storeCrate(s,kind).ok){} sim.plant(s,i,o.crop?o.crop(s,i):undefined); did=true; }
      if(did) continue;
      for(i=0;i<4&&!did;i++) if(beds[i].state==='empty'){ sim.plant(s,i,o.crop?o.crop(s,i):undefined); did=true; }
      if(did) continue;
      if(bagsReady>0 && s.bags<16){ bagsReady--; sim.addBag(s); continue; }
      var left=(D-s.t)/D, need=sim.airDrain(s)*left + sim.airDrain(s)*1.0;
      if(m.air.queue<Math.min(3,m.air.power||3) && s.air<86 && s.t<D*0.9){ sim.feedIce(s,'air'); continue; }
      if(s.water<(o.waterAt==null?20:o.waterAt)){ sim.feedIce(s,'food'); continue; }
      if(s.rack.cells>0){
        var tgt=null;
        if(m.air.power===0 && s.air<80) tgt='air';
        else if(o.dishFirst && !m.comms.on && !m.comms.broken && o.dish!==false && s.t<D*0.5) tgt='comms';   // a player who powers the dish every morning
        else if(o.scrub!==false && s.filter<(o.scrubAt==null?25:o.scrubAt)) tgt='scrub';
        else if(m.food.lamp<0.15) tgt='food';
        else if(s.bags+m.bag.pending+bagsReady<(o.bags==null?16:o.bags)) tgt='bag';
        else if(!m.comms.on&&!m.comms.broken&&o.dish!==false) tgt='comms';
        else if(o.science&&m.lab.power===0&&s.finds.filter(f=>f.kind==='core').length+m.lab.queue.length<8){tgt='lab';}
        if(tgt&&sim.plug(s,tgt).ok){ sim.takeCell(s); continue; }
      }
      if(o.science){
        var done=false;
        for(i=0;i<4&&!done;i++) if(sim.coresLeft(s,i)>0 && m.lab.queue.length<4){ sim.submitCore(s,sim.drillCore(s,i,2)); done=true; }
        if(done){next=s.t+gap*3;continue;}
        ['seismo','beam','rad'].forEach(function(id){ if(!done&&!s.inst[id]){sim.deploy(s,id);done=true;} });
        if(done){next=s.t+gap*3;continue;}
        [0,1].forEach(function(k){ if(!done&&!s.photos[k]){sim.photo(s,k);done=true;} });
      }
    }
    if(fail){ s.over={type:'fail',reason:fail}; break; }
    var last=s.sol>=s.totalSols;
    if(last&&o.science) s.caseLoaded=true;
    var rep=sim.endSol(s,{});
    log.push({sol:s.sol,air:Math.round(s.air),food:Math.round(s.food),dose:Math.round(s.dose),water:Math.round(s.water),filter:Math.round(s.filter),kind:sim.env(s).kind,whys:rep.whys.join(','),bags:s.bags,cells:s.cellsToday.toFixed(1),w:(sim.weather(s).cls||'-'),goal:rep.goalDone,fact:rep.fact.id});
    if(rep.fail) break;
    if(last){ sim.finish(s); break; }
    sim.startSol(s);
  }
  return {s:s,log:log};
}
module.exports.run=run;
