import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const EXPECTED_PRODUCT_SHA = "0565a8f084a2553fd910aa9997add13605f4d7e5";
const baseUrl = "http://127.0.0.1:3117";
const browserExecutable = process.env.M7_BROWSER_EXECUTABLE;
assert.ok(browserExecutable && existsSync(browserExecutable));
assert.ok(process.env.GROQ_API_KEY);
assert.ok(process.env.DATABASE_URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(name, fn, timeout=60000, interval=100) {
  const end=Date.now()+timeout; let last;
  while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e;}await sleep(interval);}
  throw new Error(`timeout ${name}${last instanceof Error?`: ${last.message}`:""}`);
}

const cfg=resolveRuntimeConfig({...process.env,LATTICE_DEPLOYMENT_MODE:"development",LATTICE_TRUTH_MODE:"v36-offline",LATTICE_AUTHENTICATION_MODE:"development-fixture",LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID:"topic-exact-proof",LATTICE_SOLANDRA_COGNITION_ROUTE:"groq-gpt-oss-120b"});
const composition=createConfiguredSolandraCognition(cfg); assert.ok(composition);
const cases=[
  ["Why do magnets attract some metals?","Help me plan a low-maintenance herb garden for a shaded balcony.","NEW_OBJECTIVE"],
  ["Draft a friendly note declining a dinner invitation.","What should I compare when choosing a cordless vacuum for a small apartment?","NEW_OBJECTIVE"],
  ["Why do maple leaves change color?","Why?","CONTINUE"],
  ["Help me compare cameras for hiking.","Actually, I mean cameras for indoor low-light photos.","CORRECTION"],
];
const cognitionEvidence=[];
for(let i=0;i<cases.length;i++){
  const [prior,message,expected]=cases[i];
  const r=await composition.cognition.interpret({conversationId:`direct-${i}`,messageId:`direct-msg-${i}`,message,currentObjective:prior,recentUserMessages:[prior,message],governedKnowledge:[]});
  cognitionEvidence.push({priorObjective:prior,userMessage:message,objectiveRelation:r.proposal.objectiveRelation,proposedObjective:r.proposal.proposedObjective,materialAmbiguity:r.proposal.materialAmbiguity});
  assert.equal(r.proposal.objectiveRelation,expected,JSON.stringify(cognitionEvidence.at(-1)));
}
console.log(`TOPIC_TRANSITION_REAL_COGNITION=${JSON.stringify(cognitionEvidence)}`);

const service=spawn(process.execPath,["tools/render-colocated-runtime.mjs"],{env:{...process.env,LATTICE_DEPLOYMENT_MODE:"development",LATTICE_TRUTH_MODE:"v36-offline",LATTICE_AUTHENTICATION_MODE:"development-fixture",LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID:"topic-exact-proof",LATTICE_SOLANDRA_COGNITION_ROUTE:"groq-gpt-oss-120b",LATTICE_AUTO_MIGRATE:"false",PORT:"3117",HOST:"127.0.0.1",LATTICE_RUN_WORKER_RETRY_DELAY_MS:"5"},stdio:["ignore","pipe","pipe"]});
let output=""; for(const s of [service.stdout,service.stderr]) s?.on("data",c=>{const t=c.toString();output+=t;process.stdout.write(t);});
const chrome=spawn(browserExecutable,["--headless=new","--disable-gpu","--no-sandbox","--disable-dev-shm-usage","--remote-debugging-port=9341",`--user-data-dir=${resolve("artifacts/topic-exact-profile")}`,baseUrl],{stdio:"ignore"});
class Cdp{constructor(url){this.url=url;this.id=1;this.pending=new Map();}async connect(){this.ws=new WebSocket(this.url);await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error("cdp timeout")),10000);this.ws.addEventListener("open",()=>{clearTimeout(t);res();},{once:true});this.ws.addEventListener("error",()=>{clearTimeout(t);rej(new Error("cdp error"));},{once:true});});this.ws.addEventListener("message",e=>{const m=JSON.parse(String(e.data));const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result??{});});}send(method,params={}){const id=this.id++;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params}));});}async eval(expression){const r=await this.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||"eval failed");return r.result?.value;}close(){try{this.ws?.close();}catch{}}}
async function target(){const r=await fetch("http://127.0.0.1:9341/json").catch(()=>null);if(!r?.ok)return null;return (await r.json()).find(x=>x.type==="page"&&x.webSocketDebuggerUrl);}
async function instrument(c){await waitFor("ownerFetch",()=>c.eval("typeof window.ownerFetch==='function'"));await c.eval(`(()=>{const o=window.ownerFetch;window.__proof=[];window.ownerFetch=async(...a)=>{const r=await o(...a);try{const u=typeof a[0]==='string'?a[0]:a[0]?.url||'';if(/\\/turns(?:\\?|$)/.test(u))window.__proof.push(await r.clone().json());}catch{}return r;};return true;})()`);}
async function submit(c,message){await waitFor("composer",()=>c.eval("document.getElementById('conversationInput') instanceof HTMLTextAreaElement && !document.getElementById('sendButton')?.disabled"));const before=await c.eval("window.__proof.length");await c.eval(`(()=>{const i=document.getElementById('conversationInput'),b=document.getElementById('sendButton');i.value=${JSON.stringify(message)};i.dispatchEvent(new Event('input',{bubbles:true}));b.click();return true;})()`);return waitFor("turn",async()=>{const x=await c.eval("window.__proof");return Array.isArray(x)&&x.length>before?x.at(-1):null;});}
async function terminal(c,id){return waitFor("terminal run",async()=>{const r=await c.eval(`window.ownerFetch('/api/v1/runs/${id}').then(x=>x.json())`);return ["COMPLETED","FAILED","CANCELLED"].includes(r?.status)?r:null;},60000,250);}
const pool=new Pool({connectionString:process.env.DATABASE_URL});
async function binding(runId){const r=await pool.query(`select r.request_json,b.intent_version_id from runs r join run_intent_bindings b on b.run_id=r.id where r.id=$1`,[runId]);assert.equal(r.rowCount,1);return {objective:r.rows[0].request_json.objective,sourceMessageId:r.rows[0].request_json.sourceMessageId,requestIntentVersionId:r.rows[0].request_json.intentVersionId,bindingIntentVersionId:r.rows[0].intent_version_id};}
let c;
try{
  await waitFor("api",async()=>Boolean((await fetch(`${baseUrl}/health`).catch(()=>null))?.ok),30000,200);
  const t=await waitFor("chrome",target,20000); c=new Cdp(t.webSocketDebuggerUrl);await c.connect();await c.send("Runtime.enable");await instrument(c);
  const aMsg="What makes ocean tides rise and fall?";const a=await submit(c,aMsg);assert.equal(a.interpretation?.objectiveRelation,"NEW_OBJECTIVE");assert.equal(a.acceptedUnderstanding,aMsg);await terminal(c,a.runId);
  const bMsg="What causes bread dough to rise?";const b=await submit(c,bMsg);assert.equal(b.interpretation?.objectiveRelation,"NEW_OBJECTIVE");assert.equal(b.acceptedUnderstanding,bMsg);await terminal(c,b.runId);const bb=await binding(b.runId);assert.equal(bb.objective,bMsg);assert.equal(bb.requestIntentVersionId,b.intentVersionId);assert.equal(bb.bindingIntentVersionId,b.intentVersionId);
  await c.send("Page.enable");await c.send("Page.reload",{ignoreCache:true});await waitFor("reload content",()=>c.eval(`document.body?.innerText.includes(${JSON.stringify(bMsg)})`),20000);await instrument(c);
  const cMsg="Why do some tree leaves turn red in autumn?";const cr=await submit(c,cMsg);assert.equal(cr.interpretation?.objectiveRelation,"NEW_OBJECTIVE");assert.equal(cr.acceptedUnderstanding,cMsg);await terminal(c,cr.runId);const cb=await binding(cr.runId);assert.equal(cb.objective,cMsg);assert.equal(cb.requestIntentVersionId,cr.intentVersionId);assert.equal(cb.bindingIntentVersionId,cr.intentVersionId);
  const visible=await c.eval("document.body.innerText");assert.match(visible,/tree leaves turn red/iu);
  console.log(`TOPIC_TRANSITION_BROWSER_PASS=${JSON.stringify({first:{message:aMsg,relation:a.interpretation.objectiveRelation,objective:a.acceptedUnderstanding},second:{message:bMsg,relation:b.interpretation.objectiveRelation,objective:b.acceptedUnderstanding,runObjective:bb.objective,intentVersionId:b.intentVersionId,sourceMessageId:bb.sourceMessageId},afterReload:{message:cMsg,relation:cr.interpretation.objectiveRelation,objective:cr.acceptedUnderstanding,runObjective:cb.objective,intentVersionId:cr.intentVersionId,sourceMessageId:cb.sourceMessageId},visibleCurrentTurn:true})}`);
}finally{await pool.end();c?.close();try{chrome.kill("SIGTERM");}catch{}try{service.kill("SIGTERM");}catch{}await Promise.race([once(service,"exit").catch(()=>{}),sleep(5000)]);}
assert.doesNotMatch(output,/GROQ_API_KEY|Bearer\s+[A-Za-z0-9._-]+/u);
console.log(`TOPIC_TRANSITION_EXACT_PRODUCT_SHA=${EXPECTED_PRODUCT_SHA}`);
