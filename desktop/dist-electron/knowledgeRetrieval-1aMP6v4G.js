"use strict";Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});const R=require("fs/promises"),$=require("path");function y(r){const s=Object.create(null,{[Symbol.toStringTag]:{value:"Module"}});if(r){for(const t in r)if(t!=="default"){const n=Object.getOwnPropertyDescriptor(r,t);Object.defineProperty(s,t,n.get?n:{enumerable:!0,get:()=>r[t]})}}return s.default=r,Object.freeze(s)}const m=y(R),_=y($);function h(r){const t=r.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9\s]/g," ").split(/\s+/).filter(e=>e.length>0),n=[];for(let e=0;e<t.length-1;e++)n.push(`${t[e]}${t[e+1]}`);return[...t,...n]}function k(r,s,t,n=1.5,e=.75){const i=s.length,c=new Map;for(const u of s)c.set(u,(c.get(u)||0)+1);let l=0;for(const u of r){const f=c.get(u)||0;if(f>0){const d=f*(n+1),g=f+n*(1-e+e*(i/t));l+=d/g}}return l}function j(r,s,t=500,n=100){const e=[],i=r.split(/\n\n+/).filter(u=>u.trim().length>0);let c="",l=0;for(const u of i)c.length+u.length>t&&c.length>0?(e.push({id:`${s}_chunk_${l}`,content:c.trim(),source:s,tokens:h(c)}),l++,c=c.split("").slice(-n).join("")+`

`+u):c+=(c?`

`:"")+u;return c.trim()&&e.push({id:`${s}_chunk_${l}`,content:c.trim(),source:s,tokens:h(c)}),e}function S(r){const s=h(r),t=[...s],n={小红书:["红薯","笔记","种草"],爆款:["热门","火爆","流行"],涨粉:["增粉","吸粉","粉丝增长"],流量:["曝光","播放量","阅读量"],运营:["营销","推广","增长"],标题:["题目","封面文案"],内容:["文案","正文","笔记内容"]};for(const e of s){const i=n[e];i&&t.push(...i)}return[...new Set(t)]}function A(r,s=60){const t=new Map;for(const n of r)for(let e=0;e<n.length;e++){const i=n[e],c=1/(s+e+1);t.has(i.id)?t.get(i.id).score+=c:t.set(i.id,{chunk:i,score:c})}return Array.from(t.values()).sort((n,e)=>e.score-n.score).map(n=>n.chunk)}async function b(r,s,t=3){try{const e=(await m.readdir(s)).filter(o=>o.endsWith(".txt")||o.endsWith(".md"));if(e.length===0)return{chunks:[],context:"",sources:[]};const i=[];for(const o of e){const a=await m.readFile(_.join(s,o),"utf-8"),v=j(a,o);i.push(...v)}if(i.length===0)return{chunks:[],context:"",sources:[]};const c=S(r),l=h(r),u=i.reduce((o,a)=>o+a.tokens.length,0)/i.length,f=i.map(o=>({...o,score:k(l,o.tokens,u)})).sort((o,a)=>(a.score||0)-(o.score||0)),d=i.map(o=>({...o,score:k(c,o.tokens,u)})).sort((o,a)=>(a.score||0)-(o.score||0)),p=A([f.slice(0,t*2),d.slice(0,t*2)]).slice(0,t),x=[...new Set(p.map(o=>o.source))],w=p.map((o,a)=>`[参考${a+1} - ${o.source}]
${o.content}`).join(`

---

`);return{chunks:p,context:w,sources:x}}catch(n){return console.error("RAG retrieval failed:",n),{chunks:[],context:"",sources:[]}}}async function O(r,s,t){const n=await b(s,t,3);let e=r;return n.context&&(e+=`

## 参考知识库

以下是与用户问题相关的知识内容，请在回答时参考这些信息：

${n.context}`),e+=`

## 回复要求
- 你是群聊中的一员，请根据你的角色设定发表观点
- 保持简洁，200字以内
- 如果知识库中有相关信息，请自然地融入你的回答`,{prompt:e,sources:n.sources}}exports.buildAdvisorPromptWithRAG=O;exports.hybridRetrieve=b;
