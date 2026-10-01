// renderer/index.html의 공유 함수를 gas/Code.gs에 넣고, 태블릿용 index.html을 복사
const fs=require('fs');
const html=fs.readFileSync('renderer/index.html','utf8');
const grab=name=>{const i=html.indexOf('function '+name+'(');let d=0,j=html.indexOf('{',i);for(let k=j;k<html.length;k++){if(html[k]==='{')d++;else if(html[k]==='}'){d--;if(!d)return html.slice(i,k+1)}}};
const shared=grab('mergeData')+'\n\n'+grab('parseOfferingGrid')+'\n';
fs.writeFileSync('gas/Code.gs',fs.readFileSync('gas/Code.gs.tpl','utf8').replace('/*__SHARED__*/',shared));
fs.writeFileSync('gas/index.html',html);
console.log('gas/Code.gs, gas/index.html 생성');
